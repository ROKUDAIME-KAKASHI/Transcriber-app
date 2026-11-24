import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { sendCancelEmail } from "@/lib/bookingEmail";
import { NO_STORE, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

/** The host cancels one of their bookings. The guest is emailed when email is configured. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;
  try {
    const b = await prisma.booking.findFirst({
      where: { id, hostUserId: userId },
      select: {
        id: true, status: true, guestName: true, guestEmail: true, guestNote: true, agenda: true, startAt: true, endAt: true,
        cancelToken: true, eventType: { select: { title: true } },
        host: { select: { email: true, bookingSlug: true, timeZone: true } },
      },
    });
    if (!b) return Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
    if (b.status !== "CANCELLED") {
      await prisma.booking.update({ where: { id }, data: { status: "CANCELLED" }, select: { id: true } });
      const origin = new URL(req.url).origin;
      after(() =>
        sendCancelEmail(
          {
            id: b.id, title: b.eventType.title, hostHandle: b.host.bookingSlug ?? "your host", hostEmail: b.host.email,
            hostTimeZone: b.host.timeZone ?? "UTC", guestName: b.guestName, guestEmail: b.guestEmail, guestNote: b.guestNote,
            agenda: b.agenda, startAt: b.startAt, endAt: b.endAt, origin, cancelToken: b.cancelToken,
          },
          "host"
        )
      );
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Booking cancel error:", err);
    return Response.json({ error: "Couldn't cancel the booking. Try again." }, { status: 503, headers: NO_STORE });
  }
}
