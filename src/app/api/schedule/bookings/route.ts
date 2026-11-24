import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

/** The host's upcoming confirmed bookings (those that haven't ended yet). */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const rows = await prisma.booking.findMany({
      where: { hostUserId: userId, status: "CONFIRMED", endAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 100,
      select: {
        id: true, guestName: true, guestEmail: true, guestNote: true, startAt: true, endAt: true, agenda: true,
        meetingId: true, eventType: { select: { title: true } },
      },
    });
    return Response.json(
      { bookings: rows.map((r) => ({ ...r, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), eventTitle: r.eventType.title, eventType: undefined })) },
      { headers: NO_STORE }
    );
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Bookings list error:", err);
    return Response.json({ error: "Couldn't load your bookings. Try again." }, { status: 503, headers: NO_STORE });
  }
}
