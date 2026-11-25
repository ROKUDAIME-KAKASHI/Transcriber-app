import { getUserId, unauthorized } from "@/lib/auth";
import { MAX_FREEBUSY_DAYS, validRange } from "@/lib/calendar";
import { busyIntervals, calendarMissing, calendarPaused, isCalendarMissing, workingHoursOf } from "@/lib/calendarDb";
import { pausedResponse } from "@/lib/planningDb";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The caller's own busy blocks (bookings and planned meetings, with titles: it's their own data) and working hours.
 * ?from= &to= (up to 14 days), optional &exclude=<plan id> to leave out the plan being edited.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await calendarPaused()) ?? (await pausedResponse());
  if (paused) return paused;
  const q = new URL(req.url).searchParams;
  const from = new Date(q.get("from") ?? "");
  const to = new Date(q.get("to") ?? "");
  const bad = validRange(from, to, MAX_FREEBUSY_DAYS);
  if (bad) return Response.json({ error: bad }, { status: 400, headers: NO_STORE });
  const exclude = (q.get("exclude") ?? "").slice(0, 40);
  try {
    const [items, hours] = await Promise.all([
      busyIntervals(userId, from, to, exclude ? { excludePlanId: exclude } : undefined),
      workingHoursOf(userId),
    ]);
    return Response.json(
      {
        timeZone: hours.timeZone,
        workingHours: hours.ranges,
        busy: items.map((b) => ({ start: b.startAt.toISOString(), end: b.endAt.toISOString(), title: b.title, kind: b.kind })),
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Own busy time error:", err);
    return Response.json({ error: "Couldn't load your calendar. Try again." }, { status: 503, headers: NO_STORE });
  }
}
