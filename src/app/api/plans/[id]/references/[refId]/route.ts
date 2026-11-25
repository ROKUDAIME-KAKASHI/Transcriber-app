import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { logServerError } from "@/lib/serverLog";
import { NO_STORE, failed, notFound } from "@/lib/planningDb";
import { isPreworkMissing, preworkMissing, preworkPaused } from "@/lib/preworkDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Soft delete: the extracted text stays hidden everywhere. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; refId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await preworkPaused();
  if (paused) return paused;
  const { id, refId } = await params;
  try {
    const { count } = await prisma.planReference.updateMany({
      where: { id: refId, plannedMeetingId: id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) return notFound("Reference");
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isPreworkMissing(err)) return preworkMissing();
    logServerError("DELETE /api/plans/[id]/references/[refId]", err);
    return failed("Couldn't delete this reference. Try again.");
  }
}
