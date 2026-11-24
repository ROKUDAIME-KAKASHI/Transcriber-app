import { prisma } from "@/lib/prisma";
import { PublicNotice } from "@/components/PublicNotice";
import { BookingConfirmed } from "@/components/BookingConfirmed";
import { isSchedulingMissing, tokensEqual } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

export default async function ConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { bookingId } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";

  let b;
  try {
    b = bookingId.length <= 40 && token
      ? await prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            id: true, status: true, cancelToken: true, guestName: true, guestNote: true, startAt: true, endAt: true, agenda: true,
            eventType: { select: { title: true, slug: true } }, host: { select: { bookingSlug: true } },
          },
        })
      : null;
  } catch (err) {
    if (!isSchedulingMissing(err)) console.error("Confirm page error:", err);
    return <PublicNotice title="Booking isn't available yet">Try again a little later.</PublicNotice>;
  }
  if (!b || !tokensEqual(token, b.cancelToken)) {
    return <PublicNotice title="We can't find this booking">Open the link from your confirmation again.</PublicNotice>;
  }

  return (
    <BookingConfirmed
      id={b.id}
      token={token}
      title={b.eventType.title}
      eventSlug={b.eventType.slug}
      handle={b.host.bookingSlug ?? ""}
      guestName={b.guestName}
      note={b.guestNote}
      agenda={b.agenda}
      startAt={b.startAt.toISOString()}
      endAt={b.endAt.toISOString()}
      cancelled={b.status === "CANCELLED"}
    />
  );
}
