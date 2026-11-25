import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, SERIES_SELECT, badRequest, failed, isPlanningMissing, notFound, pausedResponse, planningMissing, toSeriesDTO } from "@/lib/planningDb";
import { SeriesPatch } from "@/lib/planning";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  const parsed = SeriesPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid details");
  try {
    const { count } = await prisma.meetingSeries.updateMany({ where: { id, userId, deletedAt: null }, data: parsed.data });
    if (!count) return notFound("Series");
    const row = await prisma.meetingSeries.findFirst({ where: { id, userId }, select: SERIES_SELECT });
    return Response.json({ series: row && toSeriesDTO(row) }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Series update error:", err);
    return failed("Couldn't save the changes. Try again.");
  }
}

/** Soft delete. Its planned meetings stay, but no longer belong to a visible series. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const { count } = await prisma.meetingSeries.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) return notFound("Series");
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Series delete error:", err);
    return failed("Couldn't delete this series. Try again.");
  }
}
