import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  NO_STORE, PLAN_SELECT, attendeeRows, badRequest, failed, isPlanningMissing, ownsSeries, pausedResponse, planningMissing, toPlanDTO,
} from "@/lib/planningDb";
import { ensureAheadForUser, isUniqueViolation } from "@/lib/calendarDb";
import { PlanCreate } from "@/lib/planning";

export const dynamic = "force-dynamic";

function dateParam(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The user's live plans, soonest first. Filters: ?from=&to= (ISO start times) and ?seriesId=. */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const q = new URL(req.url).searchParams;
  const from = dateParam(q.get("from"));
  const to = dateParam(q.get("to"));
  const seriesId = (q.get("seriesId") ?? "").slice(0, 40);
  // Series set to "keep N planned ahead" top themselves up here. Never throws; a no-op until 6_calendar is applied.
  await ensureAheadForUser(userId);
  try {
    const rows = await prisma.plannedMeeting.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(from || to ? { startAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(seriesId ? { seriesId } : {}),
      },
      orderBy: { startAt: "asc" },
      take: 200,
      select: PLAN_SELECT,
    });
    return Response.json({ plans: rows.map(toPlanDTO) }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plans list error:", err);
    return failed("Couldn't load your planned meetings. Try again.");
  }
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const parsed = PlanCreate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid details");
  const { attendees, seriesId, startAt, ...rest } = parsed.data;
  try {
    if (seriesId && !(await ownsSeries(userId, seriesId))) return badRequest("That series doesn't exist");
    const created = await prisma.plannedMeeting.create({
      data: { ...rest, userId, startAt: new Date(startAt), seriesId: seriesId || null },
      select: { id: true },
    });
    if (attendees.length) await prisma.plannedAttendee.createMany({ data: attendeeRows(created.id, attendees) });
    const row = await prisma.plannedMeeting.findFirst({ where: { id: created.id, userId }, select: PLAN_SELECT });
    return Response.json({ plan: row && toPlanDTO(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    if (isUniqueViolation(err)) return badRequest("Another meeting in this series is already at that time.");
    console.error("Plan create error:", err);
    return failed("Couldn't save this meeting. Try again.");
  }
}
