"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, MapPin, Mic, Users, Video } from "lucide-react";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { formatInZone } from "@/lib/scheduling";
import { UPCOMING_DAYS, mergeUpcoming, recordHref, type PlanDTO } from "@/lib/planning";
import { loadBookings, loadPlans, type BookingDTO } from "@/lib/calendarCache";
import { useAuth } from "./AuthProvider";
import { useLocalUser } from "./SyncProvider";
import { cx } from "./ui";

/**
 * "Upcoming" at the top of Meetings: planned meetings in the next 14 days. Needs internet and the planning
 * tables, so offline, switched off or not yet migrated it renders nothing and Meetings looks as before.
 */
export function UpcomingPlans({ className }: { className?: string }) {
  const on = useFlag("plannedMeetings");
  const online = useConnectivity() !== "offline";
  const { user, cachedUser } = useAuth();
  const local = useLocalUser();
  const userId = local.userId ?? user?.id ?? cachedUser?.id ?? null;
  const [plans, setPlans] = useState<PlanDTO[] | null>(null);
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [tz, setTz] = useState("UTC");

  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      /* keep UTC */
    }
  }, []);

  useEffect(() => {
    if (!on || !online) return;
    let cancelled = false;
    const load = async () => {
      const now = Date.now();
      try {
        const [p, b] = await Promise.all([loadPlans(userId, now - 12 * 3600_000, now + UPCOMING_DAYS * 86_400_000, { readOnly: true }), loadBookings(userId)]);
        if (cancelled) return;
        if (!p) {
          setPlans(null);
          return;
        }
        setPlans(p.plans);
        if (b) setBookings(b.bookings);
      } catch {
        /* offline or server busy: keep what we have */
      }
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, online, userId]);

  const upcoming = useMemo(() => (plans ? mergeUpcoming(plans, bookings, new Date()) : []), [plans, bookings]);
  if (!on || plans === null) return null;

  return (
    <section aria-labelledby="upcoming-heading" className={className}>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 id="upcoming-heading" className="text-ui font-semibold text-muted-foreground">
          Upcoming
        </h2>
        <Link
          href="/plan?new=1"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-btn px-2 text-meta font-semibold text-accent-text hover:bg-accent-soft"
        >
          <CalendarPlus className="h-4 w-4" aria-hidden /> Plan a meeting
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <p className="rounded-panel border border-border/70 bg-card px-4 py-3 text-ui text-muted-foreground shadow-card">
          Nothing planned or booked for the next {UPCOMING_DAYS} days.
        </p>
      ) : (
        <ul className="grid gap-2">
          {upcoming.map((it) =>
            it.kind === "booking" ? (
              <li key={`b-${it.id}`}>
                <Link
                  href="/schedule"
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-panel border border-border/70 bg-card px-4 py-3 shadow-card hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ui font-semibold">{it.title} with {it.guest}</span>
                    <span className="mt-0.5 block truncate text-meta tabular-nums text-muted-foreground">{formatInZone(new Date(it.startMs).toISOString(), tz)}</span>
                  </span>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent-text">Booked</span>
                </Link>
              </li>
            ) : (
            <li key={it.id} className="flex items-stretch gap-2">
              {(() => { const p = it.plan; return (<>
              <Link
                href={`/plan?id=${p.id}`}
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-panel border border-border/70 bg-card px-4 py-3 shadow-card transition-transform duration-[var(--dur-1)] hover:bg-muted/40 active:scale-[0.98]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ui font-semibold">{p.title}</span>
                  <span className="mt-0.5 block truncate text-meta tabular-nums text-muted-foreground">{formatInZone(p.startAt, tz)}</span>
                </span>
                <span className="flex items-center gap-2.5 text-meta text-muted-foreground">
                  {p.venue && <MapPin className="h-4 w-4" aria-label={`Venue: ${p.venue}`} role="img" />}
                  {p.callUrl && <Video className="h-4 w-4" aria-label="Has a call link" role="img" />}
                  {p.attendees.length > 0 && (
                    <span className="inline-flex items-center gap-1 tabular-nums" aria-label={`${p.attendees.length} attendee${p.attendees.length === 1 ? "" : "s"}`}>
                      <Users className="h-4 w-4" aria-hidden /> {p.attendees.length}
                    </span>
                  )}
                </span>
              </Link>
              <Link
                href={recordHref(p)}
                aria-label={`Record ${p.title}`}
                className={cx(
                  "grid w-12 shrink-0 place-items-center rounded-panel border border-border/70 bg-card text-accent-text shadow-card hover:bg-accent-soft"
                )}
              >
                <Mic className="h-5 w-5" aria-hidden />
              </Link>
              </>); })()}
            </li>
          )
          )}
        </ul>
      )}
    </section>
  );
}
