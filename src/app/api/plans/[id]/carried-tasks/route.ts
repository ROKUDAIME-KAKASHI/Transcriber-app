import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, failed, isPlanningMissing, notFound, pausedResponse, planningMissing } from "@/lib/planningDb";
import { followUpPaused } from "@/lib/followUpDb";
import { CARRIED_PREFIX, parseHeading } from "@/lib/followUp";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * The recorded meetings whose tasks this plan carries, so the page can show those tasks live from the tracker.
 * In a series: every earlier recorded meeting of the series. Otherwise: the meeting named in the agenda's
 * "Carried over from <title> (<date>)" heading (same title, recorded within a day or two of that date).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await pausedResponse()) ?? (await followUpPaused());
  if (paused) return paused;
  const { id } = await params;
  if (id.length > 40) return notFound();
  try {
    const plan = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: { startAt: true, seriesId: true, agenda: true } });
    if (!plan) return notFound();
    const ids = new Set<string>();
    if (plan.seriesId) {
      const earlier = await prisma.plannedMeeting.findMany({
        where: { userId, seriesId: plan.seriesId, deletedAt: null, meetingId: { not: null }, startAt: { lt: plan.startAt } },
        orderBy: { startAt: "desc" },
        take: 60,
        select: { meetingId: true },
      });
      for (const e of earlier) if (e.meetingId) ids.add(e.meetingId);
    }
    for (const line of (plan.agenda ?? "").split("\n")) {
      if (!line.trim().startsWith(CARRIED_PREFIX)) continue;
      const h = parseHeading(line);
      if (!h) continue;
      const t = new Date(`${h.day}T12:00:00Z`).getTime();
      const found = await prisma.meeting.findMany({
        where: { userId, title: h.title, createdAt: { gte: new Date(t - 2 * DAY), lte: new Date(t + 2 * DAY) } },
        take: 5,
        select: { id: true },
      });
      for (const m of found) ids.add(m.id);
    }
    return Response.json({ meetingIds: [...ids] }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Carried tasks error:", err);
    return failed("Couldn't load the carried-over tasks.");
  }
}
