import { prisma } from "@/lib/prisma";
import { buildIcs } from "@/lib/scheduling";
import { NO_STORE, isSchedulingMissing, schedulingMissing, tokensEqual } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

/** .ics for one booking. Needs the booking's secret token (?t=). */
export async function GET(req: Request, ctx: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t");
  const notFound = () => Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
  if (!t || bookingId.length > 40) return notFound();
  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        cancelToken: true,
        guestName: true,
        guestEmail: true,
        startAt: true,
        endAt: true,
        agenda: true,
        eventType: { select: { title: true } },
        host: { select: { bookingSlug: true } },
      },
    });
    if (!b || !tokensEqual(t, b.cancelToken)) return notFound();
    const handle = b.host.bookingSlug ?? "host";
    const ics = buildIcs({
      uid: `${b.id}@transcriber`,
      start: b.startAt,
      end: b.endAt,
      title: `${b.eventType.title} with ${handle}`,
      description: b.agenda ? `Agenda\n${b.agenda}` : null,
      organizerName: handle,
      // Calendars want an address; the host's real email is never exposed.
      organizerEmail: "noreply@transcriber.invalid",
      attendeeName: b.guestName,
      attendeeEmail: b.guestEmail,
      url: `${new URL(req.url).origin}/book/confirmed/${b.id}?t=${b.cancelToken}`,
      cancelled: b.status === "CANCELLED",
    });
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="meeting.ics"',
        ...NO_STORE,
      },
    });
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("ICS error:", err);
    return Response.json({ error: "Could not create the calendar file." }, { status: 503, headers: NO_STORE });
  }
}
