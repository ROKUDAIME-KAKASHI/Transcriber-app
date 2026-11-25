import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { withLive } from "@/lib/actionItemHistory";
import { NO_STORE, failed, isPlanningMissing, notFound, pausedResponse, planningMissing } from "@/lib/planningDb";
import { parseDateOnly } from "@/lib/taskTracker";
import { aggregateSeriesProgress } from "@/lib/trackerPlus";
import { trackerPlusOn } from "@/lib/trackerPlusDb";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Done vs open for one series: the tasks of every meeting that was recorded from a plan in the series,
 * with counts by status, overdue, and a per-meeting breakdown. `?today=YYYY-MM-DD` is the caller's local day.
 */
export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  if (!(await trackerPlusOn())) return Response.json({ error: "Series progress is paused" }, { status: 503, headers: NO_STORE });
  const { id } = await params;
  const today = new URL(req.url).searchParams.get("today");
  const day = parseDateOnly(today) && today ? today : new Date().toISOString().slice(0, 10);
  try {
    const series = await prisma.meetingSeries.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, title: true } });
    if (!series) return notFound("Series");
    const plans = await prisma.plannedMeeting.findMany({
      where: { userId, seriesId: id, deletedAt: null, meetingId: { not: null } },
      select: { meetingId: true, title: true, startAt: true },
    });
    const meetingIds = plans.map((p) => p.meetingId).filter((m): m is string => !!m);
    const [meetings, tasks] = meetingIds.length
      ? await Promise.all([
          prisma.meeting.findMany({ where: { id: { in: meetingIds }, userId }, select: { id: true, title: true } }),
          withLive((live) =>
            prisma.actionItem.findMany({
              where: { userId, meetingId: { in: meetingIds }, ...live },
              select: { meetingId: true, status: true, dueDate: true },
              take: 5000,
            })
          ),
        ])
      : [[], []];
    const titles = new Map(meetings.map((m) => [m.id, m.title]));
    const progress = aggregateSeriesProgress(
      tasks.map((t) => ({ meetingId: t.meetingId, status: t.status, dueDate: t.dueDate ? t.dueDate.toISOString() : null })),
      plans
        .filter((p) => p.meetingId && titles.has(p.meetingId))
        .map((p) => ({ meetingId: p.meetingId as string, title: titles.get(p.meetingId as string) || p.title, date: p.startAt.toISOString() })),
      day
    );
    return Response.json({ series: { id: series.id, title: series.title }, ...progress }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Series progress error:", err instanceof Error ? err.message : "unknown");
    return failed("Couldn't load the series progress. Try again.");
  }
}
