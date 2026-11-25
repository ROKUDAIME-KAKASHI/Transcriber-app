import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PLAN_SELECT, attendeeRows, failed, isPlanningMissing, notFound, pausedResponse, planningMissing, toPlanDTO } from "@/lib/planningDb";
import { isUniqueViolation } from "@/lib/calendarDb";
import { nextOccurrence, type Cadence } from "@/lib/planning";

export const dynamic = "force-dynamic";

/**
 * Plans the next meeting of a series from its latest one: same weekday and time of day in the same time zone,
 * with the same title, length, venue, link and attendees. The agenda starts empty (carrying unfinished tasks
 * comes with the follow-up step). Asking twice returns the meeting already planned for that time.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const series = await prisma.meetingSeries.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, cadence: true } });
    if (!series) return notFound("Series");
    const latest = await prisma.plannedMeeting.findFirst({
      where: { userId, seriesId: id, deletedAt: null },
      orderBy: { startAt: "desc" },
      select: { title: true, startAt: true, durationMin: true, timeZone: true, venue: true, callUrl: true, attendees: { select: { stakeholderId: true, name: true, email: true, designation: true, role: true } } },
    });
    if (!latest) return Response.json({ error: "Plan the first meeting of this series first." }, { status: 404, headers: NO_STORE });
    const next = nextOccurrence(latest.startAt.getTime(), series.cadence as Cadence, latest.timeZone, Date.now());
    if (next === null) return failed("Couldn't work out the next date. Pick it by hand.");

    const startAt = new Date(next);
    const same = await prisma.plannedMeeting.findFirst({
      where: { userId, seriesId: id, startAt, deletedAt: null, status: { not: "CANCELLED" } },
      select: PLAN_SELECT,
    });
    if (same) return Response.json({ plan: toPlanDTO(same), existing: true }, { headers: NO_STORE });

    const created = await prisma.plannedMeeting.create({
      data: {
        userId, seriesId: id, title: latest.title, startAt, durationMin: latest.durationMin, timeZone: latest.timeZone,
        venue: latest.venue, callUrl: latest.callUrl,
      },
      select: { id: true },
    });
    if (latest.attendees.length) await prisma.plannedAttendee.createMany({ data: attendeeRows(created.id, latest.attendees) });
    const row = await prisma.plannedMeeting.findFirst({ where: { id: created.id, userId }, select: PLAN_SELECT });
    return Response.json({ plan: row && toPlanDTO(row), existing: false }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    if (isUniqueViolation(err)) {
      // A concurrent request, or a cancelled meeting at that time (6_calendar), already holds the slot.
      return Response.json({ error: "That date is already taken in this series (it may be a cancelled meeting). Pick the next date by hand." }, { status: 409, headers: NO_STORE });
    }
    console.error("Series next error:", err);
    return failed("Couldn't plan the next meeting. Try again.");
  }
}
