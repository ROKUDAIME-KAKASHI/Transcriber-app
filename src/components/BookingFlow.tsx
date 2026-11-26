"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { MAX_RANGE_DAYS, dayKey, formatInZone, wallClockOf, zonedToUtc } from "@/lib/scheduling";
import { Button, FieldLabel, Panel, cx, inputCls, selectCls } from "./ui";

interface PublicEventInfo {
  slug: string;
  title: string;
  durationMin: number;
  description: string | null;
  maxDaysAhead: number;
}

interface Props {
  handle: string;
  events: PublicEventInfo[];
  initialSlug: string;
  hostTimeZone: string;
  agenda: { id: string; text: string } | null;
}

const STEP_DAYS = 14;

function zoneList(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  if (!list.includes("UTC")) list = ["UTC", ...list];
  return list.includes(current) ? list : [current, ...list];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function BookingFlow({ handle, events, initialSlug, hostTimeZone, agenda }: Props) {
  const router = useRouter();
  const [eventSlug, setEventSlug] = useState(events.some((e) => e.slug === initialSlug) ? initialSlug : events[0].slug);
  const event = events.find((e) => e.slug === eventSlug) ?? events[0];
  const [tz, setTz] = useState(hostTimeZone);
  const [editingTz, setEditingTz] = useState(false);
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState(1);
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // The guest's own zone is only known in the browser.
  useEffect(() => {
    let z = hostTimeZone;
    try {
      z = Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimeZone;
    } catch {
      /* keep the host zone */
    }
    setTz(z);
    setReady(true);
  }, [hostTimeZone]);

  const zones = useMemo(() => zoneList(tz), [tz]);
  const horizon = Math.min(STEP_DAYS * pages, MAX_RANGE_DAYS - 1, event.maxDaysAhead + 1);
  const canLookFurther = STEP_DAYS * pages < Math.min(MAX_RANGE_DAYS - 1, event.maxDaysAhead + 1);

  // Calendar days (YYYY-MM-DD in the guest's zone) from today.
  const days = useMemo(() => {
    if (!ready) return [] as string[];
    const w = wallClockOf(Date.now(), tz);
    return Array.from({ length: horizon }, (_, i) => {
      const d = new Date(Date.UTC(w.y, w.m - 1, w.d + i));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    });
  }, [ready, tz, horizon]);

  useEffect(() => {
    if (!days.length) return;
    const ctrl = new AbortController();
    const [y, m, d] = days[0].split("-").map(Number);
    const first = zonedToUtc({ y, m, d, h: 0, min: 0 }, tz) ?? Date.UTC(y, m - 1, d);
    const to = Math.min(first + horizon * 86_400_000, first + MAX_RANGE_DAYS * 86_400_000 - 1);
    setLoading(true);
    setLoadError(null);
    fetch(`/api/book/${handle}/${event.slug}/slots?from=${encodeURIComponent(new Date(first).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error || "Could not load times. Try again.");
        setSlots(data.slots as string[]);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setSlots([]);
        setLoadError(e instanceof TypeError ? "Could not reach the server. Check your connection." : (e as Error).message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [days, horizon, tz, handle, event.slug, refresh]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const k = dayKey(s, tz);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return m;
  }, [slots, tz]);

  // Pick the first free day when times load and nothing valid is selected.
  useEffect(() => {
    if (loading) return;
    if (!day || !byDay.has(day)) {
      const first = days.find((k) => byDay.has(k)) ?? null;
      setDay(first);
      setSlot(null);
    }
  }, [loading, byDay, day, days]);

  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const dayLabel = (key: string) => {
    const dt = new Date(`${key}T00:00:00Z`);
    return {
      wd: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(dt),
      d: dt.getUTCDate(),
      mo: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(dt),
    };
  };
  const dayHeading = day
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))
    : "";

  const pickSlot = (s: string) => {
    setSlot(s);
    setFormError(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const pickEvent = (slug: string) => {
    if (slug === eventSlug) return;
    setEventSlug(slug);
    setPages(1);
    setDay(null);
    setSlot(null);
    setSlots([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot || submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/book/${handle}/${event.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, note: note || undefined, startAt: slot, agendaId: agenda?.id ?? null, website }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setFormError(data?.error || "Could not book that time. Try again.");
        if (res.status === 409) {
          setSlot(null);
          setRefresh((n) => n + 1);
        }
        return;
      }
      router.push(`/book/confirmed/${data.id}?t=${encodeURIComponent(data.cancelToken)}`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Book a time with {handle}</h1>
        {event.description && <p className="mt-1 whitespace-pre-line text-ui text-muted-foreground">{event.description}</p>}
      </div>

      {events.length > 1 && (
        <div role="group" aria-label="Meeting length" className="flex flex-wrap gap-2">
          {events.map((e) => (
            <button
              key={e.slug}
              type="button"
              aria-pressed={e.slug === eventSlug}
              onClick={() => pickEvent(e.slug)}
              className={cx(
                "inline-flex min-h-12 items-center rounded-chip border px-4 text-ui font-semibold transition-colors lg:min-h-10",
                e.slug === eventSlug ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
              )}
            >
              {e.durationMin} min
            </button>
          ))}
        </div>
      )}

      {agenda && (
        <Panel className="p-4">
          <h2 className="flex items-center gap-2 text-ui font-semibold">
            <ListChecks className="h-4 w-4 text-accent-text" aria-hidden />
            Agenda for this meeting
          </h2>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line text-ui text-muted-foreground">{agenda.text}</p>
        </Panel>
      )}

      <Panel className="space-y-4 p-4">
        <div role="group" aria-label="Pick a day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-busy={loading}>
          {days.map((k) => {
            const free = byDay.has(k);
            const sel = k === day;
            const l = dayLabel(k);
            return (
              <button
                key={k}
                type="button"
                disabled={!free}
                aria-pressed={sel}
                aria-label={`${l.wd} ${l.d} ${l.mo}${free ? "" : ", no times"}`}
                onClick={() => {
                  setDay(k);
                  setSlot(null);
                }}
                className={cx(
                  "flex min-h-16 w-14 shrink-0 flex-col items-center justify-center rounded-chip border text-meta transition-colors",
                  sel ? "border-accent bg-accent text-accent-foreground" : free ? "border-border/70 bg-card hover:bg-muted" : "border-transparent text-muted-foreground opacity-50",
                  loading && "opacity-60"
                )}
              >
                <span>{l.wd}</span>
                <span className="text-ui font-semibold tabular-nums">{l.d}</span>
                <span>{l.mo}</span>
              </button>
            );
          })}
        </div>

        {loadError ? (
          <div className="space-y-3">
            <p className="text-ui text-danger-text" role="alert">
              {loadError}
            </p>
            <Button onClick={() => setRefresh((n) => n + 1)}>Try again</Button>
          </div>
        ) : loading && slots.length === 0 ? (
          <div role="status" aria-busy="true" className="grid grid-cols-3 gap-2">
            <span className="sr-only">Loading times</span>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-chip bg-muted" />
            ))}
          </div>
        ) : daySlots.length === 0 ? (
          <div className="space-y-2">
            <p className="text-ui text-muted-foreground">No free times in the next {horizon} days.</p>
            {canLookFurther && (
              <Button variant="secondary" onClick={() => setPages((p) => p + 1)}>
                Look further ahead
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Free times on ${dayHeading}`}>
            {daySlots.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === slot}
                onClick={() => pickSlot(s)}
                className={cx(
                  "min-h-12 rounded-btn border px-2 text-ui font-semibold tabular-nums transition-[background-color,transform] duration-[var(--dur-1)] active:scale-[0.97]",
                  s === slot ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
                )}
              >
                {formatInZone(s, tz, false)}
              </button>
            ))}
          </div>
        )}

        <div>
          <p className="text-meta text-muted-foreground">
            Times in {tz.replace(/_/g, " ")} ·{" "}
            <button type="button" className="font-semibold text-accent-text" onClick={() => setEditingTz((v) => !v)} aria-expanded={editingTz}>
              Change
            </button>
          </p>
          {editingTz && (
            <div className="mt-2">
              <label htmlFor="guest-tz" className="sr-only">
                Your time zone
              </label>
              <select id="guest-tz" value={tz} onChange={(e) => setTz(e.target.value)} className={selectCls}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Panel>

      {slot && (
        <form ref={formRef} onSubmit={submit} className="space-y-4 rounded-panel border border-border/70 bg-card p-4 shadow-card">
          <p className="text-ui font-semibold">
            {formatInZone(slot, tz)} · {event.durationMin} min
          </p>
          <div>
            <FieldLabel htmlFor="guest-name">Name</FieldLabel>
            <input id="guest-name" required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <FieldLabel htmlFor="guest-email">Email</FieldLabel>
            <input id="guest-email" type="email" required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <div>
            <FieldLabel htmlFor="guest-note">Note (optional)</FieldLabel>
            <textarea id="guest-note" maxLength={1000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, "py-3 leading-6")} />
          </div>
          {/* Honeypot: people never see or fill this. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          {formError && (
            <p className="text-meta text-danger-text" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
            Book
          </Button>
        </form>
      )}
    </div>
  );
}
