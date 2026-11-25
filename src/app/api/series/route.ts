import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, SERIES_SELECT, badRequest, failed, isPlanningMissing, pausedResponse, planningMissing, toSeriesDTO } from "@/lib/planningDb";
import { SeriesCreate } from "@/lib/planning";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  try {
    const rows = await prisma.meetingSeries.findMany({
      where: { userId, deletedAt: null },
      orderBy: { title: "asc" },
      take: 200,
      select: SERIES_SELECT,
    });
    return Response.json({ series: rows.map(toSeriesDTO) }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Series list error:", err);
    return failed("Couldn't load your series. Try again.");
  }
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const parsed = SeriesCreate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid details");
  try {
    // Saving the same series twice (a double tap) returns the first one.
    const dup = await prisma.meetingSeries.findFirst({
      where: { userId, deletedAt: null, title: { equals: parsed.data.title, mode: "insensitive" }, cadence: parsed.data.cadence },
      select: SERIES_SELECT,
    });
    if (dup) return Response.json({ series: toSeriesDTO(dup) }, { headers: NO_STORE });
    const row = await prisma.meetingSeries.create({ data: { ...parsed.data, userId }, select: SERIES_SELECT });
    return Response.json({ series: toSeriesDTO(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Series create error:", err);
    return failed("Couldn't save this series. Try again.");
  }
}
