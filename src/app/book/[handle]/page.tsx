import { PublicNotice } from "@/components/PublicNotice";
import { BookingFlow } from "@/components/BookingFlow";
import { findAgendaFor, isSchedulingMissing, listPublicEvents } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

export default async function HostPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ agenda?: string; a?: string }>;
}) {
  const { handle } = await params;
  const q = await searchParams;
  const agendaId = (typeof q.agenda === "string" ? q.agenda : typeof q.a === "string" ? q.a : "").slice(0, 40);

  let data: Awaited<ReturnType<typeof listPublicEvents>>;
  let agenda: { text: string } | null = null;
  try {
    data = await listPublicEvents(handle);
    if (data && agendaId) agenda = await findAgendaFor(data.host.id, agendaId);
  } catch (err) {
    if (!isSchedulingMissing(err)) console.error("Booking page error:", err);
    return <PublicNotice title="Booking isn't available yet">Try again a little later.</PublicNotice>;
  }
  if (!data) return <PublicNotice title="This booking link doesn't exist">Check the link you were sent.</PublicNotice>;
  if (data.events.length === 0) {
    return <PublicNotice title="Nothing is open for booking right now">Check back a little later.</PublicNotice>;
  }

  return (
    <BookingFlow
      handle={data.host.handle}
      events={data.events.map((e) => ({ slug: e.slug, title: e.title, durationMin: e.durationMin, description: e.description, maxDaysAhead: e.maxDaysAhead }))}
      initialSlug={data.events[0].slug}
      hostTimeZone={data.host.timeZone}
      agenda={agenda && agendaId ? { id: agendaId, text: agenda.text } : null}
    />
  );
}
