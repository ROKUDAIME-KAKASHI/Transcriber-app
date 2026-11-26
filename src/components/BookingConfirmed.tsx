"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarX, Check, Download, ExternalLink } from "lucide-react";
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

  const btn =
    "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10";

  return (
    <div className="mx-auto max-w-xl space-y-6 text-center">
      <div className="space-y-3">
        <span
          className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${cancelled ? "bg-danger-soft text-danger-text" : "bg-success-soft text-success-text"}`}
        >
          {cancelled ? <CalendarX className="h-8 w-8" aria-hidden /> : <Check className="h-8 w-8" aria-hidden />}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{cancelled ? "Booking cancelled" : "You're booked"}</h1>
        <div>
          <p className={`text-ui font-semibold ${cancelled ? "line-through" : ""}`}>{full}</p>
          <p className="mt-0.5 text-meta text-muted-foreground">
            {p.title} with {p.handle} · {tz.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {(p.note || p.agenda) && (
        <Panel as="div" className="space-y-3 p-4 text-left">
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
      )}

      {!cancelled && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href={`/api/book/ics/${p.id}?t=${encodeURIComponent(p.token)}`} download="meeting.ics" className={btn}>
            <Download className="h-4 w-4" aria-hidden />
            Add to calendar
          </a>
          <a href={google} target="_blank" rel="noopener noreferrer" className={btn}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Google Calendar
          </a>
        </div>
      )}

      {error && (
        <p className="text-meta text-danger-text" role="alert">
          {error}
        </p>
      )}

      {cancelled ? (
        p.handle && (
          <Link href={`/book/${p.handle}/${p.eventSlug}`} className="inline-flex min-h-11 items-center text-ui font-semibold text-accent-text">
            Book another time
          </Link>
        )
      ) : confirming ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-ui">Cancel this meeting?</span>
          <Button variant="danger-solid" loading={busy} onClick={() => void cancel()}>
            Yes, cancel it
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <button type="button" className="min-h-11 px-3 text-meta font-semibold text-danger-text" onClick={() => setConfirming(true)}>
          Cancel booking
        </button>
      )}
    </div>
  );
}
