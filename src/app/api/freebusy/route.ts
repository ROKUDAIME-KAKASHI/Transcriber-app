import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { MAX_FREEBUSY_DAYS, MAX_FREEBUSY_EMAILS, mergeIntervals, parseEmailList, validRange } from "@/lib/calendar";
import { busyIntervals, calendarMissing, calendarPaused, isCalendarMissing, workingHoursOf } from "@/lib/calendarDb";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
// Every call counts, hit or miss, so the endpoint can't be used to sweep for addresses.
const limiter = new FailureLimiter(30, 60_000);

/**
 * Busy blocks of other Minutely users who chose to share them. Signed in. ?emails=a,b (up to 10) &from= &to= (up to 14 days).
 * Anyone who has no account, hasn't opted in, or is the caller gets the identical `{ status: "unknown" }`, so the
 * answer never reveals whether an account exists. Only start/end times and working hours are returned: no titles or details.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await calendarPaused();
  if (paused) return paused;
  if (limiter.blocked(userId)) {
    return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: NO_STORE });
  }
  limiter.fail(userId);

  const q = new URL(req.url).searchParams;
  const emails = parseEmailList(q.get("emails"));
  if (emails === null) {
    return Response.json({ error: `Ask about at most ${MAX_FREEBUSY_EMAILS} people at a time.` }, { status: 400, headers: NO_STORE });
  }
  if (emails.length === 0) return Response.json({ error: "Add at least one email address." }, { status: 400, headers: NO_STORE });
  const from = new Date(q.get("from") ?? "");
  const to = new Date(q.get("to") ?? "");
  const bad = validRange(from, to, MAX_FREEBUSY_DAYS);
  if (bad) return Response.json({ error: bad }, { status: 400, headers: NO_STORE });

  try {
    const sharers = await prisma.user.findMany({
      where: { email: { in: emails }, shareFreeBusy: true, NOT: { id: userId } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(sharers.map((u) => [u.email.toLowerCase(), u.id]));
    const people: Record<string, unknown> = {};
    await Promise.all(
      emails.map(async (email) => {
        const id = byEmail.get(email);
        if (!id) {
          people[email] = { status: "unknown" };
          return;
        }
        try {
          const [items, hours] = await Promise.all([busyIntervals(id, from, to), workingHoursOf(id)]);
          const busy = mergeIntervals(items.map((b) => ({ start: b.startAt.getTime(), end: b.endAt.getTime() }))).map((i) => ({
            start: new Date(i.start).toISOString(),
            end: new Date(i.end).toISOString(),
          }));
          // Hours in their own zone; without a saved zone the caller assumes its own working hours.
          people[email] = { status: "shared", busy, workingHours: hours.timeZone ? { timeZone: hours.timeZone, ranges: hours.ranges } : null };
        } catch (err) {
          if (isCalendarMissing(err)) throw err;
          console.error("Free/busy read error:", err);
          people[email] = { status: "unknown" };
        }
      })
    );
    return Response.json({ people }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Free/busy error:", err);
    return Response.json({ error: "Couldn't load availability. Try again." }, { status: 503, headers: NO_STORE });
  }
}
