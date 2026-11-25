import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PLAN_SELECT, failed, isPlanningMissing, pausedResponse, planningMissing, toPlanDTO } from "@/lib/planningDb";

export const dynamic = "force-dynamic";

/** The plan a recorded meeting was started from, or `{ plan: null }`. Owner only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  if (id.length > 40) return Response.json({ plan: null }, { headers: NO_STORE });
  try {
    const row = await prisma.plannedMeeting.findFirst({ where: { meetingId: id, userId, deletedAt: null }, select: PLAN_SELECT });
    return Response.json({ plan: row ? toPlanDTO(row) : null }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Meeting plan error:", err);
    return failed("Couldn't load the planned meeting.");
  }
}
