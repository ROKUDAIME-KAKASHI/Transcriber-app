import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PLAN_SELECT, failed, isPlanningMissing, notFound, pausedResponse, planningMissing } from "@/lib/planningDb";
import { followUpPaused, planFollowUp, readBody, type FollowUpSource } from "@/lib/followUpDb";
import { previousRecorded } from "@/lib/followUp";

export const dynamic = "force-dynamic";

/** Nearest 15 minutes, 15 minutes to 4 hours; an unknown length (0) is 30 minutes. */
function durationFromSeconds(sec: number): number {
  if (!sec || sec < 0) return 30;
  return Math.min(240, Math.max(15, Math.round(sec / 60 / 15) * 15));
}

/**
 * Plan the next meeting after a recorded meeting. When the recording came from a plan, that plan (series, attendees,
 * venue, link) is the source; otherwise the next meeting is one week later at the same time, in the caller's zone.
 * Asking twice returns the same meeting. Owner only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await pausedResponse()) ?? (await followUpPaused());
  if (paused) return paused;
  const { id } = await params;
  if (id.length > 40) return notFound("Meeting");
  const body = readBody(await req.json().catch(() => null));
  try {
    const m = await prisma.meeting.findFirst({ where: { id, userId }, select: { id: true, title: true, createdAt: true, durationSec: true } });
    if (!m) return notFound("Meeting");
    const p = await prisma.plannedMeeting.findFirst({ where: { meetingId: id, userId, deletedAt: null }, select: PLAN_SELECT });
    const src: FollowUpSource = p
      ? {
          title: p.title, startAt: p.startAt, durationMin: p.durationMin, timeZone: p.timeZone, venue: p.venue, callUrl: p.callUrl,
          seriesId: p.seriesId, meetingId: id,
          attendees: p.attendees.map((a) => ({ stakeholderId: a.stakeholderId, name: a.name, email: a.email, designation: a.designation, role: a.role })),
        }
      : {
          title: m.title, startAt: m.createdAt, durationMin: durationFromSeconds(m.durationSec), timeZone: body.timeZone ?? "UTC",
          venue: null, callUrl: null, seriesId: null, attendees: [], meetingId: id,
        };
    const r = await planFollowUp(userId, src, { today: body.today });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return Response.json({ plan: r.plan, existing: r.existing, carried: r.carried, added: r.added }, { status: r.existing ? 200 : 201, headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Meeting follow-up error:", err);
    return failed("Couldn't plan the next meeting. Try again.");
  }
}

/** The earlier recorded meeting of the same series, for "Follow-up of ...". `{ previous: null }` when there isn't one. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await pausedResponse()) ?? (await followUpPaused());
  if (paused) return paused;
  const { id } = await params;
  if (id.length > 40) return Response.json({ previous: null }, { headers: NO_STORE });
  try {
    const cur = await prisma.plannedMeeting.findFirst({ where: { meetingId: id, userId, deletedAt: null }, select: { startAt: true, seriesId: true } });
    if (!cur?.seriesId) return Response.json({ previous: null }, { headers: NO_STORE });
    const plans = await prisma.plannedMeeting.findMany({
      where: { userId, seriesId: cur.seriesId, deletedAt: null, meetingId: { not: null }, startAt: { lt: cur.startAt } },
      orderBy: { startAt: "desc" },
      take: 5,
      select: { startAt: true, meetingId: true },
    });
    const prev = previousRecorded(plans, cur.startAt.getTime());
    if (!prev?.meetingId) return Response.json({ previous: null }, { headers: NO_STORE });
    const m = await prisma.meeting.findFirst({ where: { id: prev.meetingId, userId }, select: { id: true, title: true } });
    return Response.json({ previous: m ? { meetingId: m.id, title: m.title, startAt: prev.startAt.toISOString() } : null }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Meeting previous error:", err);
    return failed("Couldn't look up the earlier meeting.");
  }
}
