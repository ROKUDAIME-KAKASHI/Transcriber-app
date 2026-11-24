"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarX, Download, ExternalLink } from "lucide-react";
import { formatInZone, googleCalendarUrl } from "@/lib/scheduling";
import { Button, Panel } from "./ui";

interface Props {
  id: string;
  token: string;
  title: string;
  eventSlug: string;
  handle: string;
  guestName: string;
  note: string | null;
  agenda: string | null;
  startAt: string;
  endAt: string;
  cancelled: boolean;
}

export function BookingConfirmed(p: Props) {
  const [tz, setTz] = useState("UTC");
  const [cancelled, setCancelled] = useState(p.cancelled);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      /* keep UTC */
    }
  }, []);

  const start = new Date(p.startAt);
  const end = new Date(p.endAt);
  const full = `${formatInZone(start, tz)} to ${formatInZone(end, tz, false)}`;
  const google = googleCalendarUrl({
    title: `${p.title} with ${p.handle}`,
    start,
    end,
    details: p.agenda ? `Agenda\n${p.agenda}` : null,
  });

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/book/cancel/${p.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: p.token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Could not cancel the booking. Try again.");
        return;
      }
      setCancelled(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${cancelled ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}>
          {cancelled ? <CalendarX className="h-5 w-5" aria-hidden /> : <CalendarCheck className="h-5 w-5" aria-hidden />}
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{cancelled ? "Booking cancelled" : "You're booked"}</h1>
          <p className="mt-0.5 text-ui text-muted-foreground">
            {cancelled ? "This meeting is off your calendar." : `Thanks, ${p.guestName}. Save the details below.`}
          </p>
        </div>
      </div>

      <Panel as="div" className="space-y-3 p-4">
        <div>
          <p className="text-meta font-semibold text-muted-foreground">What</p>
          <p className="text-ui font-semibold">
            {p.title} with {p.handle}
          </p>
        </div>
        <div>
          <p className="text-meta font-semibold text-muted-foreground">When</p>
          <p className={`text-ui ${cancelled ? "line-through" : ""}`}>{full}</p>
          <p className="text-meta text-muted-foreground">{tz.replace(/_/g, " ")}</p>
        </div>
        {p.note && (
          <div>
            <p className="text-meta font-semibold text-muted-foreground">Your note</p>
            <p className="whitespace-pre-line text-ui">{p.note}</p>
          </div>
        )}
        {p.agenda && (
          <div>
            <p className="text-meta font-semibold text-muted-foreground">Agenda</p>
            <p className="whitespace-pre-line text-ui">{p.agenda}</p>
          </div>
        )}
      </Panel>

      {!cancelled && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={`/api/book/ics/${p.id}?t=${encodeURIComponent(p.token)}`}
            download="meeting.ics"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10"
          >
            <Download className="h-4 w-4" aria-hidden />
            Add to calendar
          </a>
          <a
            href={google}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Google Calendar
          </a>
        </div>
      )}

      {error && (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      )}

      {cancelled ? (
        p.handle && (
          <Link href={`/book/${p.handle}/${p.eventSlug}`} className="inline-flex min-h-11 items-center text-ui font-semibold text-accent">
            Book another time
          </Link>
        )
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui">Cancel this meeting?</span>
          <Button variant="danger-solid" loading={busy} onClick={() => void cancel()}>
            Yes, cancel it
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Cancel booking
        </Button>
      )}
    </div>
  );
}
