import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { emailConfigured, sendMail } from "@/lib/bookingEmail";
import { calendarMissing, calendarPaused, isCalendarMissing } from "@/lib/calendarDb";
import { MAX_INVITE_RECIPIENTS, icsMethodFor, inviteSubject } from "@/lib/calendar";
import { planIcs } from "@/lib/planIcs";
import { NO_STORE, PLAN_SELECT, badRequest, failed, notFound, pausedResponse, toPlanDTO } from "@/lib/planningDb";
import { whenText } from "@/lib/planning";

export const dynamic = "force-dynamic";
// Resend allows about two sends a second, so a full list of 30 takes a while.
export const maxDuration = 60;

// Each send attempt counts: 3 per plan and 10 per person per hour.
const planLimiter = new FailureLimiter(3, 60 * 60_000);
const userLimiter = new FailureLimiter(10, 60 * 60_000);

// Daily ceiling on emails (not sends) per person, so the owner's Resend account can't be used as a relay.
const MAX_EMAILS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60_000;
const emailLog = new Map<string, number[]>();
function emailsToday(userId: string, now: number): number[] {
  const list = (emailLog.get(userId) ?? []).filter((t) => now - t < DAY_MS);
  if (list.length) emailLog.set(userId, list);
  else emailLog.delete(userId);
  return list;
}

const Body = z.object({ mode: z.enum(["invite", "cancel"]) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Emails the plan's attendees that have an address. mode "invite" sends an invitation (or an update when they
 * were invited before) and mode "cancel" sends a cancellation to those who were invited. The .ics is attached
 * with METHOD:REQUEST or METHOD:CANCEL and the plan's SEQUENCE. Records `invitedAt` per attendee that was reached.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await calendarPaused()) ?? (await pausedResponse());
  if (paused) return paused;
  if (!emailConfigured()) {
    return Response.json({ error: "Email isn't set up on this server.", code: "email_not_configured" }, { status: 503, headers: NO_STORE });
  }
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");
  const mode = parsed.data.mode;

  try {
    const [row, me, extra] = await Promise.all([
      prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: PLAN_SELECT }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.plannedMeeting.findFirst({
        where: { id, userId, deletedAt: null },
        select: { icsSequence: true, attendees: { select: { id: true, invitedAt: true } } },
      }),
    ]);
    if (!row || !me || !extra) return notFound();
    const plan = toPlanDTO(row);
    if (mode === "invite" && plan.status !== "PLANNED") return badRequest("Only a planned meeting can be sent as an invite.");
    if (mode === "cancel" && plan.status !== "CANCELLED") return badRequest("Cancel the meeting first.");

    const invitedAt = new Map(extra.attendees.map((a) => [a.id, a.invitedAt]));
    const own = me.email.toLowerCase();
    const seen = new Set<string>();
    const recipients = plan.attendees.filter((a) => {
      const email = a.email?.toLowerCase();
      if (!email || email === own || seen.has(email)) return false;
      if (mode === "cancel" && !(a.id && invitedAt.get(a.id))) return false;
      seen.add(email);
      return true;
    });
    if (recipients.length === 0) {
      return badRequest(mode === "cancel" ? "Nobody was emailed an invite, so there is nobody to tell." : "Add an email address to at least one attendee.");
    }
    if (recipients.length > MAX_INVITE_RECIPIENTS) {
      return badRequest(`Invites go to up to ${MAX_INVITE_RECIPIENTS} people at once. Remove some, or share the invite file instead.`);
    }
    if (planLimiter.blocked(id) || userLimiter.blocked(userId)) {
      return Response.json({ error: "You've sent a lot of invites. Try again in an hour." }, { status: 429, headers: NO_STORE });
    }
    const nowMs = Date.now();
    const today = emailsToday(userId, nowMs);
    if (today.length + recipients.length > MAX_EMAILS_PER_DAY) {
      return Response.json({ error: "You've reached today's limit for invite emails. Try again tomorrow, or share the invite file." }, { status: 429, headers: NO_STORE });
    }
    planLimiter.fail(id);
    userLimiter.fail(userId);
    for (let i = 0; i < recipients.length; i++) today.push(nowMs);
    emailLog.set(userId, today);

    const everInvited = extra.attendees.some((a) => a.invitedAt);
    const kind = mode === "cancel" ? "cancel" : everInvited ? "update" : "invite";
    const method = mode === "cancel" ? "CANCEL" : icsMethodFor(plan.status, recipients.length);
    const ics = planIcs(plan, me.email, { method, sequence: extra.icsSequence });
    const when = `${whenText(plan)} (${plan.timeZone.replace(/_/g, " ")})`;
    const lead =
      kind === "cancel" ? "This meeting has been cancelled." : kind === "update" ? "This meeting has changed. The new details are below." : "You're invited to a meeting.";
    const body = [
      lead,
      "",
      plan.title,
      `When: ${when}`,
      plan.venue ? `Where: ${plan.venue}` : "",
      plan.callUrl && kind !== "cancel" ? `Join: ${plan.callUrl}` : "",
      kind !== "cancel" && plan.agenda?.trim() ? `\nAgenda\n${plan.agenda.trim().slice(0, 2000)}` : "",
      "",
      kind === "cancel" ? "The attached file removes it from your calendar." : "Open the attached file to add it to your calendar, and reply to say if you can come.",
      `Organizer: ${me.email}`,
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

    const subject = inviteSubject(plan.title, plan.startAt, plan.timeZone, kind);
    const reached: string[] = [];
    const failedTo: string[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (i > 0) await sleep(550);
      const mail = () =>
        sendMail({
          to: r.email as string,
          subject,
          text: `Hi ${r.name.replace(/\s+/g, " ").trim().slice(0, 100)},

${body}
`,
          ics,
          icsName: "invite.ics",
          icsType: `text/calendar; method=${method}; charset=utf-8`,
          replyTo: me.email,
        });
      let ok = await mail();
      if (!ok) {
        await sleep(1200);
        ok = await mail();
      }
      if (ok && r.id) reached.push(r.id);
      else failedTo.push(r.name);
    }
    if (reached.length) {
      // Cancellation clears the mark so a restored meeting starts fresh with "Send invites".
      await prisma.plannedAttendee.updateMany({
        where: { id: { in: reached }, plannedMeetingId: id },
        data: { invitedAt: mode === "cancel" ? null : new Date() },
      });
    }
    return Response.json({ sent: reached.length, failed: failedTo, kind }, { status: reached.length ? 200 : 502, headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Plan invite error:", err);
    return failed("Couldn't send the invites. Try again.");
  }
}
