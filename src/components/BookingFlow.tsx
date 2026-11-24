"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, Globe, ListChecks } from "lucide-react";
import { dayKey, formatInZone, wallClockOf, zonedToUtc } from "@/lib/scheduling";
import { Button, FieldLabel, Panel, cx, inputCls, selectCls } from "./ui";

interface Props {
  handle: string;
  event: { slug: string; title: string; durationMin: number; description: string | null; maxDaysAhead: number };
  hostTimeZone: string;
  agenda: { id: string; text: string } | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export function BookingFlow({ handle, event, hostTimeZone, agenda }: Props) {
  const router = useRouter();
  const [tz, setTz] = useState(hostTimeZone);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null); // m: 0-11
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
    const w = wallClockOf(Date.now(), z);
    setCursor({ y: w.y, m: w.m - 1 });
  }, [hostTimeZone]);

  const zones = useMemo(() => zoneList(tz), [tz]);
  const today = cursor ? dayKey(new Date(), tz) : "";

  // Free times for the visible month, fetched whenever the month or zone changes.
  useEffect(() => {
    if (!cursor) return;
    const ctrl = new AbortController();
    const first = zonedToUtc({ y: cursor.y, m: cursor.m + 1, d: 1, h: 0, min: 0 }, tz) ?? Date.UTC(cursor.y, cursor.m, 1);
    const next = zonedToUtc({ y: cursor.m === 11 ? cursor.y + 1 : cursor.y, m: ((cursor.m + 1) % 12) + 1, d: 1, h: 0, min: 0 }, tz) ?? Date.UTC(cursor.y, cursor.m + 1, 1);
    setLoading(true);
    setLoadError(null);
    fetch(`/api/book/${handle}/${event.slug}/slots?from=${encodeURIComponent(new Date(first).toISOString())}&to=${encodeURIComponent(new Date(next).toISOString())}`, {
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
  }, [cursor, tz, handle, event.slug, refresh]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const k = dayKey(s, tz);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return m;
  }, [slots, tz]);

  // Pick the first free day when a month loads and nothing valid is selected.
  useEffect(() => {
    if (loading) return;
    if (!day || !byDay.has(day)) {
      const first = [...byDay.keys()].sort()[0] ?? null;
      setDay(first);
      setSlot(null);
    }
  }, [loading, byDay, day]);

  const cells = useMemo(() => {
    if (!cursor) return [];
    const lead = (new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)] as (number | null)[];
  }, [cursor]);

  const monthLabel = cursor
    ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.y, cursor.m, 1)))
    : "";
  const todayParts = today ? today.split("-").map(Number) : null;
  const atCurrentMonth = !!cursor && !!todayParts && cursor.y === todayParts[0] && cursor.m + 1 === todayParts[1];
  const lastMonthAllowed = (() => {
    const w = wallClockOf(Date.now() + event.maxDaysAhead * 86_400_000, tz);
    return { y: w.y, m: w.m - 1 };
  })();
  const atLastMonth = !!cursor && (cursor.y > lastMonthAllowed.y || (cursor.y === lastMonthAllowed.y && cursor.m >= lastMonthAllowed.m));
  const step = (delta: number) =>
    setCursor((c) => {
      if (!c) return c;
      const idx = c.y * 12 + c.m + delta;
      return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
    });

  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const dayHeading = day
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))
    : "";

  const pickSlot = (s: string) => {
    setSlot(s);
    setFormError(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
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
    <div className="space-y-6">
      <div>
        <p className="text-meta font-semibold text-muted-foreground">{handle}</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{event.title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-ui text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden />
          {event.durationMin} minutes
        </p>
        {event.description && <p className="mt-2 max-w-prose whitespace-pre-line text-ui text-muted-foreground">{event.description}</p>}
      </div>

      {agenda && (
        <Panel className="p-4">
          <h2 className="flex items-center gap-2 text-ui font-semibold">
            <ListChecks className="h-4 w-4 text-accent" aria-hidden />
            Agenda for this meeting
          </h2>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line text-ui text-muted-foreground">{agenda.text}</p>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Panel className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-ui font-semibold" aria-live="polite">
              {monthLabel}
            </h2>
            <div className="flex gap-1">
              <Button variant="ghost" className="!min-h-11 !min-w-11 px-0" aria-label="Previous month" disabled={!cursor || atCurrentMonth} onClick={() => step(-1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="ghost" className="!min-h-11 !min-w-11 px-0" aria-label="Next month" disabled={!cursor || atLastMonth} onClick={() => step(1)}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-meta text-muted-foreground" aria-hidden>
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className={cx("mt-1 grid grid-cols-7 gap-1 transition-opacity", loading && "opacity-50")} aria-busy={loading}>
            {cells.map((d, i) => {
              if (d === null) return <span key={`b${i}`} />;
              const key = `${cursor!.y}-${pad(cursor!.m + 1)}-${pad(d)}`;
              const free = byDay.has(key);
              const selected = key === day;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!free}
                  aria-pressed={selected}
                  aria-label={`${d} ${monthLabel}${free ? "" : ", no times"}`}
                  onClick={() => {
                    setDay(key);
                    setSlot(null);
                  }}
                  className={cx(
                    "grid h-11 place-items-center rounded-chip text-ui tabular-nums transition-colors",
                    selected ? "bg-accent font-semibold text-accent-foreground" : free ? "bg-accent-soft font-semibold text-foreground hover:bg-accent-soft/70" : "text-muted-foreground opacity-60",
                    key === today && !selected && "ring-1 ring-border"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-border/70 pt-3">
            <label htmlFor="guest-tz" className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold">
              <Globe className="h-4 w-4" aria-hidden />
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
        </Panel>

        <div className="space-y-6">
          <Panel className="p-4">
            <h2 className="text-ui font-semibold">{dayHeading || "Pick a day"}</h2>
            {loadError ? (
              <div className="mt-3 space-y-3">
                <p className="text-ui text-danger" role="alert">
                  {loadError}
                </p>
                <Button onClick={() => setRefresh((n) => n + 1)}>Try again</Button>
              </div>
            ) : loading && slots.length === 0 ? (
              <div role="status" aria-busy="true" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <span className="sr-only">Loading times</span>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-chip bg-muted" />
                ))}
              </div>
            ) : daySlots.length === 0 ? (
              <p className="mt-2 text-ui text-muted-foreground">
                {byDay.size === 0 ? "No free times this month. Try another month." : "Pick a highlighted day to see times."}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={`Free times on ${dayHeading}`}>
                {daySlots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={s === slot}
                    onClick={() => pickSlot(s)}
                    className={cx(
                      "min-h-12 rounded-btn border px-3 text-ui font-semibold tabular-nums transition-[background-color,transform] duration-[var(--dur-1)] active:scale-[0.97]",
                      s === slot ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
                    )}
                  >
                    {formatInZone(s, tz, false)}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {slot && (
            <form ref={formRef} onSubmit={submit} className="space-y-4 rounded-panel border border-border/70 bg-card p-4 shadow-card">
              <div>
                <h2 className="text-ui font-semibold">Your details</h2>
                <p className="mt-0.5 text-meta text-muted-foreground">
                  {formatInZone(slot, tz)} ({tz.replace(/_/g, " ")})
                </p>
              </div>
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
                <textarea id="guest-note" maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, "py-3 leading-6")} />
              </div>
              {/* Honeypot: people never see or fill this. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>
              {formError && (
                <p className="text-meta text-danger" role="alert">
                  {formError}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full sm:w-auto">
                Confirm booking
              </Button>
            </form>
          )}
        </div>
      </div>

      <p className="text-meta text-muted-foreground">
        <Link href={`/book/${handle}`} className="font-semibold text-accent">
          See other meeting types
        </Link>
      </p>
    </div>
  );
}
