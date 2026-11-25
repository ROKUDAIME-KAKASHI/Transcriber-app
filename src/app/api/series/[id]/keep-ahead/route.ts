import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { KEEP_AHEAD_CHOICES } from "@/lib/calendar";
import { calendarMissing, calendarPaused, ensureAheadForUser, isCalendarMissing } from "@/lib/calendarDb";
import { NO_STORE, failed, notFound, pausedResponse } from "@/lib/planningDb";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** How many future meetings this series keeps planned (0 = off). */
export async function GET(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await calendarPaused()) ?? (await pausedResponse());
  if (paused) return paused;
  const { id } = await params;
  try {
    const s = await prisma.meetingSeries.findFirst({ where: { id, userId, deletedAt: null }, select: { keepAhead: true } });
    if (!s) return notFound("Series");
    return Response.json({ keepAhead: s.keepAhead }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Keep-ahead read error:", err);
    return failed("Couldn't load this setting. Try again.");
  }
}

const Body = z.object({
  keepAhead: z.number().int().refine((n) => (KEEP_AHEAD_CHOICES as readonly number[]).includes(n), "Pick 0, 2, 4 or 8"),
});

/** Saves the setting and tops the series up right away. */
export async function PUT(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await calendarPaused()) ?? (await pausedResponse());
  if (paused) return paused;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400, headers: NO_STORE });
  try {
    const { count } = await prisma.meetingSeries.updateMany({ where: { id, userId, deletedAt: null }, data: { keepAhead: parsed.data.keepAhead } });
    if (!count) return notFound("Series");
    const countPlans = () => prisma.plannedMeeting.count({ where: { userId, seriesId: id, deletedAt: null } });
    const before = parsed.data.keepAhead > 0 ? await countPlans() : 0;
    await ensureAheadForUser(userId, { seriesId: id, force: true });
    const after = parsed.data.keepAhead > 0 ? await countPlans() : 0;
    return Response.json({ keepAhead: parsed.data.keepAhead, created: Math.max(0, after - before) }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Keep-ahead save error:", err);
    return failed("Couldn't save this setting. Try again.");
  }
}
