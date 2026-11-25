import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { calendarMissing, calendarPaused, isCalendarMissing } from "@/lib/calendarDb";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The caller's calendar sharing choice. Off by default. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await calendarPaused();
  if (paused) return paused;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { shareFreeBusy: true } });
    return Response.json({ shareFreeBusy: u?.shareFreeBusy ?? false }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Calendar prefs read error:", err);
    return Response.json({ error: "Couldn't load this setting. Try again." }, { status: 503, headers: NO_STORE });
  }
}

const Body = z.object({ shareFreeBusy: z.boolean() });

export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await calendarPaused();
  if (paused) return paused;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  try {
    await prisma.user.update({ where: { id: userId }, data: { shareFreeBusy: parsed.data.shareFreeBusy }, select: { id: true } });
    return Response.json({ shareFreeBusy: parsed.data.shareFreeBusy }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Calendar prefs save error:", err);
    return Response.json({ error: "Couldn't save this setting. Try again." }, { status: 503, headers: NO_STORE });
  }
}
