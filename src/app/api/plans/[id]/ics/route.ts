import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PLAN_SELECT, failed, isPlanningMissing, notFound, pausedResponse, planningMissing, toPlanDTO } from "@/lib/planningDb";
import { sequenceOf } from "@/lib/calendarDb";
import { icsMethodFor } from "@/lib/calendar";
import { planIcs } from "@/lib/planIcs";

export const dynamic = "force-dynamic";

/** .ics for one plan. Owner only (the invite is built from the owner's private plan). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const [row, me] = await Promise.all([
      prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: PLAN_SELECT }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!row || !me) return notFound();
    const p = toPlanDTO(row);
    // Invite semantics (REQUEST / CANCEL, SEQUENCE, RSVP) only while the calendar feature is live; else exactly as before.
    const sequence = await sequenceOf(id);
    const guests = p.attendees.filter((a) => a.email).length;
    const ics = planIcs(p, me.email, sequence === null ? undefined : { method: icsMethodFor(p.status, guests), sequence });
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="meeting.ics"',
        ...NO_STORE,
      },
    });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan ICS error:", err);
    return failed("Couldn't create the calendar file.");
  }
}
