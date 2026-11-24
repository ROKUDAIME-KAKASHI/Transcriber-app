import { prisma } from "@/lib/prisma";
import { MAX_RANGE_DAYS, generateSlots } from "@/lib/scheduling";
import { NO_STORE, findPublicEvent, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

/** Free start times (ISO, UTC) between ?from= and ?to=, at most 45 days apart. Public. */
export async function GET(req: Request, ctx: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const from = new Date(q.get("from") ?? "");
  const to = new Date(q.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return Response.json({ error: "Invalid date range." }, { status: 400, headers: NO_STORE });
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return Response.json({ error: `Ask for at most ${MAX_RANGE_DAYS} days at a time.` }, { status: 400, headers: NO_STORE });
  }
  try {
    const found = await findPublicEvent(handle, slug);
    if (!found) return Response.json({ error: "This booking link does not exist." }, { status: 404, headers: NO_STORE });
    const { host, event } = found;
    const [availability, bookings] = await Promise.all([
      prisma.availability.findMany({ where: { userId: host.id }, select: { weekday: true, startMin: true, endMin: true } }),
      prisma.booking.findMany({
        where: {
          hostUserId: host.id,
          status: "CONFIRMED",
          startAt: { lt: new Date(to.getTime() + 86_400_000) },
          endAt: { gt: new Date(from.getTime() - 86_400_000) },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);
    const slots = generateSlots({
      availability,
      timeZone: host.timeZone,
      durationMin: event.durationMin,
      bufferMin: event.bufferMin,
      minNoticeMin: event.minNoticeMin,
      maxDaysAhead: event.maxDaysAhead,
      bookings,
      from,
      to,
      now: new Date(),
    });
    return Response.json({ slots, hostTimeZone: host.timeZone }, { headers: NO_STORE });
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Slots error:", err);
    return Response.json({ error: "Could not load times. Try again." }, { status: 503, headers: NO_STORE });
  }
}
