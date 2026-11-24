import { PublicNotice } from "@/components/PublicNotice";
import { BookingFlow } from "@/components/BookingFlow";
import { findAgendaFor, findPublicEvent, isSchedulingMissing, listPublicEvents } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>;
  searchParams: Promise<{ agenda?: string; a?: string }>;
}) {
  const { handle, slug } = await params;
  const q = await searchParams;
  const agendaId = (typeof q.agenda === "string" ? q.agenda : typeof q.a === "string" ? q.a : "").slice(0, 40);

  let found: Awaited<ReturnType<typeof findPublicEvent>>;
  let agenda: { text: string } | null = null;
  let all: { slug: string; title: string; durationMin: number; description: string | null; maxDaysAhead: number }[] = [];
  try {
    found = await findPublicEvent(handle, slug);
    if (found && agendaId) agenda = await findAgendaFor(found.host.id, agendaId);
    if (found) all = (await listPublicEvents(handle))?.events ?? [];
  } catch (err) {
    if (!isSchedulingMissing(err)) console.error("Booking page error:", err);
    return <PublicNotice title="Booking isn't available yet">Try again a little later.</PublicNotice>;
  }
  if (!found) return <PublicNotice title="This booking link doesn't exist">Check the link you were sent.</PublicNotice>;

  const { host, event } = found;
  const events = all.some((e) => e.slug === event.slug) ? all : [event, ...all];
  return (
    <BookingFlow
      handle={host.handle}
      events={events.map((e) => ({ slug: e.slug, title: e.title, durationMin: e.durationMin, description: e.description, maxDaysAhead: e.maxDaysAhead }))}
      initialSlug={event.slug}
      hostTimeZone={host.timeZone}
      agenda={agenda && agendaId ? { id: agendaId, text: agenda.text } : null}
    />
  );
}
