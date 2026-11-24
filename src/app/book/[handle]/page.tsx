import Link from "next/link";
import { Clock, ChevronRight } from "lucide-react";
import { PublicNotice } from "@/components/PublicNotice";
import { isSchedulingMissing, listPublicEvents } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

export default async function HostPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  let data: Awaited<ReturnType<typeof listPublicEvents>>;
  try {
    data = await listPublicEvents(handle);
  } catch (err) {
    if (!isSchedulingMissing(err)) console.error("Booking page error:", err);
    return <PublicNotice title="Booking isn't available yet">Try again a little later.</PublicNotice>;
  }
  if (!data) return <PublicNotice title="This booking link doesn't exist">Check the link you were sent.</PublicNotice>;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Book a time with {data.host.handle}</h1>
      <p className="mt-1 text-ui text-muted-foreground">Pick a meeting type to see free times.</p>
      {data.events.length === 0 ? (
        <p className="mt-6 text-ui text-muted-foreground">Nothing is open for booking right now.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/book/${data.host.handle}/${e.slug}`}
                className="flex min-h-16 items-center gap-3 rounded-panel border border-border/70 bg-card p-4 shadow-card transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-semibold">{e.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-meta text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {e.durationMin} minutes
                  </span>
                  {e.description && <span className="mt-1 block text-meta text-muted-foreground">{e.description}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
