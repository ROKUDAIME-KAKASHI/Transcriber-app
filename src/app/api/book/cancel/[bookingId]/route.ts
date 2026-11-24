import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { sendCancelEmail } from "@/lib/bookingEmail";
import { NO_STORE, clientIp, isSchedulingMissing, schedulingMissing, tokensEqual } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

const Body = z.object({ t: z.string().min(1).max(100) });
const limiter = new FailureLimiter(20, 60 * 60 * 1000);

/** A guest cancels their own booking with the secret token from their link. */
export async function POST(req: Request, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  const ip = clientIp(req);
  if (limiter.blocked(ip)) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
  const body = Body.safeParse(await req.json().catch(() => null));
  const notFound = () => {
    limiter.fail(ip);
    return Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
  };
  if (!body.success || bookingId.length > 40) return notFound();
  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        cancelToken: true,
        guestName: true,
        guestEmail: true,
        guestNote: true,
        agenda: true,
        startAt: true,
        endAt: true,
        eventType: { select: { title: true } },
        host: { select: { email: true, bookingSlug: true, timeZone: true } },
      },
    });
    if (!b || !tokensEqual(body.data.t, b.cancelToken)) return notFound();
    if (b.status !== "CANCELLED") {
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" }, select: { id: true } });
      const origin = new URL(req.url).origin;
      after(() =>
        sendCancelEmail(
          {
            id: b.id,
            title: b.eventType.title,
            hostHandle: b.host.bookingSlug ?? "host",
            hostEmail: b.host.email,
            hostTimeZone: b.host.timeZone ?? "UTC",
            guestName: b.guestName,
            guestEmail: b.guestEmail,
            guestNote: b.guestNote,
            agenda: b.agenda,
            startAt: b.startAt,
            endAt: b.endAt,
            origin,
            cancelToken: body.data.t,
          },
          "guest"
        )
      );
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Guest cancel error:", err);
    return Response.json({ error: "Could not cancel the booking. Try again." }, { status: 503, headers: NO_STORE });
  }
}
