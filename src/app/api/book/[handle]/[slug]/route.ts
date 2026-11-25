import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { isFlagOn } from "@/lib/flags";
import { prisma } from "@/lib/prisma";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { isSlotAvailable } from "@/lib/scheduling";
import { sendBookingEmails } from "@/lib/bookingEmail";
import { NO_STORE, clientIp, findAgendaFor, findPublicEvent, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";
import { MAX_AGENDA_CHARS } from "@/lib/followUpAgenda";
import { createPlanForBooking } from "@/lib/planningDb";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z
    .string()
    .max(300)
    .transform((v) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .pipe(z.string().min(1).max(100)),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
  note: z.string().trim().max(1000).optional(),
  startAt: z.string().max(40),
  agendaId: z.string().max(40).nullable().optional(),
  website: z.string().max(200).optional(), // honeypot: humans leave it empty
});

// Every attempt counts, so a script cannot probe slots or flood a host's calendar.
const ipLimiter = new FailureLimiter(10, 60 * 60 * 1000);
const MAX_FUTURE_PER_GUEST = 3;

class SlotTaken extends Error {}
class TooMany extends Error {}

/** Create a booking. Public: abuse is limited by IP, honeypot and a per-guest cap. */
export async function POST(req: Request, ctx: { params: Promise<{ handle: string; slug: string }> }) {
  if (!(await isFlagOn("scheduling"))) return Response.json({ error: "Booking is turned off" }, { status: 503, headers: NO_STORE });
  const { handle, slug } = await ctx.params;
  const ip = clientIp(req);
  if (ipLimiter.blocked(ip)) {
    return Response.json({ error: "Too many bookings from this network. Try again later." }, { status: 429, headers: NO_STORE });
  }
  ipLimiter.fail(ip);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "email"
        ? "Enter a valid email address."
        : field === "name"
          ? "Enter your name (up to 100 characters)."
          : field === "note"
            ? "Keep the note under 1000 characters."
            : "Invalid request";
    return Response.json({ error }, { status: 400, headers: NO_STORE });
  }
  const b = parsed.data;
  // Honeypot: pretend it worked so bots do not adapt.
  if (b.website?.trim()) return Response.json({ id: "ok", cancelToken: "ok" }, { headers: NO_STORE });

  const start = new Date(b.startAt);
  if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
    return Response.json({ error: "That time is not available. Pick another." }, { status: 409, headers: NO_STORE });
  }

  try {
    const found = await findPublicEvent(handle, slug);
    if (!found) return Response.json({ error: "This booking link does not exist." }, { status: 404, headers: NO_STORE });
    const { host, event } = found;
    const end = new Date(start.getTime() + event.durationMin * 60_000);
    const agendaRow = await findAgendaFor(host.id, b.agendaId);
    const agenda = agendaRow ? agendaRow.text.slice(0, MAX_AGENDA_CHARS) : null;
    const cancelToken = randomBytes(24).toString("base64url");

    const booking = await prisma.$transaction(async (tx) => {
      // One booking at a time per host: the lock is released when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${host.id}))`;
      const [availability, bookings, mine] = await Promise.all([
        tx.availability.findMany({ where: { userId: host.id }, select: { weekday: true, startMin: true, endMin: true } }),
        tx.booking.findMany({
          where: {
            hostUserId: host.id,
            status: "CONFIRMED",
            startAt: { lt: new Date(end.getTime() + 86_400_000) },
            endAt: { gt: new Date(start.getTime() - 86_400_000) },
          },
          select: { startAt: true, endAt: true },
        }),
        tx.booking.count({ where: { hostUserId: host.id, guestEmail: b.email, status: "CONFIRMED", startAt: { gt: new Date() } } }),
      ]);
      if (mine >= MAX_FUTURE_PER_GUEST) throw new TooMany();
      const ok = isSlotAvailable(start, {
        availability,
        timeZone: host.timeZone,
        durationMin: event.durationMin,
        bufferMin: event.bufferMin,
        minNoticeMin: event.minNoticeMin,
        maxDaysAhead: event.maxDaysAhead,
        bookings,
        now: new Date(),
      });
      if (!ok) throw new SlotTaken();
      return tx.booking.create({
        data: {
          eventTypeId: event.id,
          hostUserId: host.id,
          guestName: b.name,
          guestEmail: b.email,
          guestNote: b.note || null,
          startAt: start,
          endAt: end,
          cancelToken,
          agenda,
          followUpFromMeetingId: agendaRow?.followUpFromMeetingId ?? null,
        },
        select: { id: true },
      });
    });

    // The host's calendar gets a planned meeting too. Never fails the booking (table missing, feature off: skipped).
    await createPlanForBooking({
      bookingId: booking.id, hostUserId: host.id, eventTitle: event.title, guestName: b.name, guestEmail: b.email,
      agenda, startAt: start, durationMin: event.durationMin, hostTimeZone: host.timeZone,
    });

    const origin = new URL(req.url).origin;
    after(async () => {
      const hostUser = await prisma.user.findUnique({ where: { id: host.id }, select: { email: true } }).catch(() => null);
      if (!hostUser) return;
      await sendBookingEmails({
        id: booking.id,
        title: event.title,
        hostHandle: host.handle,
        hostEmail: hostUser.email,
        hostTimeZone: host.timeZone,
        guestName: b.name,
        guestEmail: b.email,
        guestNote: b.note || null,
        agenda,
        startAt: start,
        endAt: end,
        origin,
        cancelToken,
      });
    });
    return Response.json({ id: booking.id, cancelToken }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof SlotTaken) {
      return Response.json({ error: "Someone just took that time. Pick another." }, { status: 409, headers: NO_STORE });
    }
    if (err instanceof TooMany) {
      return Response.json({ error: "You already have 3 upcoming bookings with this host. Cancel one first." }, { status: 429, headers: NO_STORE });
    }
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Booking error:", err);
    return Response.json({ error: "Could not book that time. Try again." }, { status: 503, headers: NO_STORE });
  }
}
