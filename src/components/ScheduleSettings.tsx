"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CloudOff, Copy, Mic, Plus, Share2, Trash2, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { useConnectivity } from "@/lib/connectivity";
import { copyText, shareText } from "@/lib/export/deliver";
import { DURATIONS, formatInZone, validateHandle } from "@/lib/scheduling";
import { useToast } from "./Toast";
import { Badge, Button, FieldLabel, Notice, Panel, PanelHeader, Switch, cx, inputCls, selectCls } from "./ui";

interface Range {
  startMin: number;
  endMin: number;
}
interface EventForm {
  id: string | null;
  slug: string;
  title: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  active: boolean;
  description: string | null;
}
interface BookingRow {
  id: string;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  startAt: string;
  endAt: string;
  agenda: string | null;
  eventTitle: string;
}

// Monday first, as most calendars show it. Numbers follow JavaScript: 0 = Sunday.
const DAYS = [
  { n: 1, label: "Monday" }, { n: 2, label: "Tuesday" }, { n: 3, label: "Wednesday" }, { n: 4, label: "Thursday" },
  { n: 5, label: "Friday" }, { n: 6, label: "Saturday" }, { n: 0, label: "Sunday" },
];
const BUFFERS = [0, 5, 10, 15, 30];
const NOTICES = [
  { v: 0, l: "No notice" }, { v: 60, l: "1 hour" }, { v: 120, l: "2 hours" }, { v: 240, l: "4 hours" },
  { v: 720, l: "12 hours" }, { v: 1440, l: "1 day" }, { v: 2880, l: "2 days" },
];
const AHEAD = [7, 14, 30, 60, 90];

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

function suggestHandle(email: string | undefined): string {
  const base = (email ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return base.length >= 3 ? base : "";
}

function timeZones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  if (!list.includes("UTC")) list = ["UTC", ...list];
  return list.includes(current) ? list : [current, ...list];
}

const fieldCls = inputCls;

export function ScheduleSettings() {
  const toast = useToast();
  const { user, cachedUser } = useAuth();
  const offline = useConnectivity() === "offline";
  const email = user?.email ?? cachedUser?.email;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [savedHandle, setSavedHandle] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [tz, setTz] = useState("UTC");
  const [days, setDays] = useState<Record<number, Range[]>>({});
  const [events, setEvents] = useState<EventForm[]>([]);
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const zones = useMemo(() => timeZones(tz), [tz]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/schedule/settings", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setLoadError(data?.error || "Couldn't load your schedule. Try again.");
        return;
      }
      setSavedHandle(data.handle);
      setHandle(data.handle ?? suggestHandle(email));
      setTz(data.timeZone ?? browserTz);
      const byDay: Record<number, Range[]> = {};
      for (const r of data.availability as { weekday: number; startMin: number; endMin: number }[]) {
        (byDay[r.weekday] ??= []).push({ startMin: r.startMin, endMin: r.endMin });
      }
      setDays(byDay);
      setEvents(data.eventTypes);
      void loadBookings();
    } catch {
      setLoadError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserTz, email]);

  const loadBookings = async () => {
    try {
      const res = await fetch("/api/schedule/bookings", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setBookingsError(data?.error || "Couldn't load your bookings.");
        return;
      }
      setBookingsError(null);
      setBookings(data.bookings);
    } catch {
      setBookingsError("Couldn't load your bookings.");
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const setRange = (day: number, i: number, patch: Partial<Range>) =>
    setDays((d) => ({ ...d, [day]: (d[day] ?? []).map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const addRange = (day: number) =>
    setDays((d) => {
      const list = d[day] ?? [];
      const last = list[list.length - 1];
      const start = last ? Math.min(last.endMin + 60, 22 * 60) : 10 * 60;
      return { ...d, [day]: [...list, { startMin: start, endMin: Math.min(start + 120, 1439) }] };
    });
  const removeRange = (day: number, i: number) => setDays((d) => ({ ...d, [day]: (d[day] ?? []).filter((_, k) => k !== i) }));
  const toggleDay = (day: number, on: boolean) => setDays((d) => ({ ...d, [day]: on ? [{ startMin: 10 * 60, endMin: 17 * 60 }] : [] }));

  const setEvent = (i: number, patch: Partial<EventForm>) => setEvents((list) => list.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const addEvent = () =>
    setEvents((list) => {
      let n = list.length + 1;
      while (list.some((e) => e.slug === `meeting-${n}`)) n++;
      return [...list, { id: null, slug: `meeting-${n}`, title: "New meeting", durationMin: 30, bufferMin: 0, minNoticeMin: 120, maxDaysAhead: 30, active: true, description: null }];
    });

  const save = async () => {
    setFormError(null);
    const h = validateHandle(handle);
    if (!h.ok) {
      setFormError(h.error);
      return;
    }
    const availability = DAYS.flatMap(({ n }) => (days[n] ?? []).map((r) => ({ weekday: n, ...r })));
    if (availability.some((r) => !(r.startMin < r.endMin))) {
      setFormError("Each time range must end after it starts.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/schedule/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: h.handle, timeZone: tz, availability, eventTypes: events }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.error || "Couldn't save. Try again.");
        return;
      }
      toast("Schedule saved", "success");
      await load();
    } catch {
      setFormError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const linkFor = (slug: string) => `${window.location.origin}/book/${savedHandle}/${slug}`;
  const copyLink = async (slug: string) => {
    try {
      await copyText(linkFor(slug));
      toast("Booking link copied", "success");
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.", "danger");
    }
  };
  const shareLink = async (slug: string, title: string) => {
    try {
      const r = await shareText(linkFor(slug), `Book a time: ${title}`);
      if (r === "copied") toast("Sharing isn't available here. Link copied instead.", "neutral");
    } catch {
      toast("Couldn't share the link. Try Copy.", "danger");
    }
  };

  const cancelBooking = async (id: string) => {
    try {
      const res = await fetch(`/api/schedule/bookings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast("Couldn't cancel the booking. Try again.", "danger");
        return;
      }
      setBookings((b) => (b ? b.filter((x) => x.id !== id) : b));
      setConfirmId(null);
      toast("Booking cancelled", "success");
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    }
  };

  const hostTz = savedHandle ? tz : browserTz;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="mt-1 text-ui text-muted-foreground">Share a link so people can book time with you.</p>
      </div>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="Scheduling needs internet">
          Connect to the internet to change your schedule or see bookings.
        </Notice>
      )}

      {loading ? (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">Loading</span>
          <div className="h-32 animate-pulse rounded-panel bg-muted" />
          <div className="h-48 animate-pulse rounded-panel bg-muted" />
        </div>
      ) : loadError ? (
        <Notice tone="danger" title="Couldn't load Schedule">
          <p>{loadError}</p>
          <Button className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      ) : (
        <>
          <Panel>
            <PanelHeader title="Your booking page" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="sch-handle">Booking handle</FieldLabel>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-meta text-muted-foreground">/book/</span>
                  <input
                    id="sch-handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby="sch-handle-hint"
                    className={fieldCls}
                  />
                </div>
                <p id="sch-handle-hint" className="mt-1 text-meta text-muted-foreground">
                  3 to 30 letters, numbers or hyphens. Guests see this name, never your email.
                </p>
              </div>
              <div>
                <FieldLabel htmlFor="sch-tz">Your time zone</FieldLabel>
                <select id="sch-tz" value={tz} onChange={(e) => setTz(e.target.value)} className={selectCls}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                {tz !== browserTz && (
                  <button type="button" className="mt-1 text-meta font-semibold text-accent" onClick={() => setTz(browserTz)}>
                    Use this device&apos;s zone ({browserTz.replace(/_/g, " ")})
                  </button>
                )}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Weekly hours" meta={tz.replace(/_/g, " ")} />
            <ul className="divide-y divide-border/70">
              {DAYS.map(({ n, label }) => {
                const ranges = days[n] ?? [];
                const on = ranges.length > 0;
                return (
                  <li key={n} className="p-2 sm:p-3">
                    <Switch checked={on} onChange={(v) => toggleDay(n, v)} label={label} description={on ? undefined : "Unavailable"} />
                    {on && (
                      <div className="space-y-2 px-3 pb-2 pt-1">
                        {ranges.map((r, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2">
                            <input
                              type="time"
                              aria-label={`${label} range ${i + 1} start`}
                              value={toTime(r.startMin)}
                              onChange={(e) => !Number.isNaN(fromTime(e.target.value)) && setRange(n, i, { startMin: fromTime(e.target.value) })}
                              className={cx(fieldCls, "!w-32")}
                            />
                            <span className="text-meta text-muted-foreground" aria-hidden>
                              to
                            </span>
                            <input
                              type="time"
                              aria-label={`${label} range ${i + 1} end`}
                              value={toTime(r.endMin)}
                              onChange={(e) => !Number.isNaN(fromTime(e.target.value)) && setRange(n, i, { endMin: fromTime(e.target.value) })}
                              className={cx(fieldCls, "!w-32")}
                            />
                            <Button
                              variant="ghost"
                              className="!min-h-11 !min-w-11 px-0"
                              aria-label={`Remove ${label} range ${i + 1}`}
                              onClick={() => (ranges.length === 1 ? toggleDay(n, false) : removeRange(n, i))}
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                        <Button variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => addRange(n)}>
                          Add hours
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Event types" meta={`${events.length} of 10`} />
            <div className="space-y-4 p-4">
              {events.map((e, i) => (
                <div key={e.id ?? `new-${i}`} className="space-y-3 rounded-chip border border-border/70 p-3 sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor={`ev-title-${i}`}>Title</FieldLabel>
                      <input id={`ev-title-${i}`} value={e.title} maxLength={80} onChange={(x) => setEvent(i, { title: x.target.value })} className={fieldCls} />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`ev-slug-${i}`}>Link ending</FieldLabel>
                      <input
                        id={`ev-slug-${i}`}
                        value={e.slug}
                        maxLength={30}
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(x) => setEvent(i, { slug: x.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                        className={fieldCls}
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`ev-dur-${i}`}>Length</FieldLabel>
                      <select id={`ev-dur-${i}`} value={e.durationMin} onChange={(x) => setEvent(i, { durationMin: Number(x.target.value) })} className={selectCls}>
                        {DURATIONS.map((d) => (
                          <option key={d} value={d}>
                            {d} minutes
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`ev-buf-${i}`}>Gap between meetings</FieldLabel>
                      <select id={`ev-buf-${i}`} value={e.bufferMin} onChange={(x) => setEvent(i, { bufferMin: Number(x.target.value) })} className={selectCls}>
                        {BUFFERS.map((b) => (
                          <option key={b} value={b}>
                            {b === 0 ? "None" : `${b} minutes`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`ev-notice-${i}`}>Minimum notice</FieldLabel>
                      <select id={`ev-notice-${i}`} value={e.minNoticeMin} onChange={(x) => setEvent(i, { minNoticeMin: Number(x.target.value) })} className={selectCls}>
                        {NOTICES.map((n) => (
                          <option key={n.v} value={n.v}>
                            {n.l}
                          </option>
                        ))}
                        {!NOTICES.some((n) => n.v === e.minNoticeMin) && <option value={e.minNoticeMin}>{e.minNoticeMin} minutes</option>}
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`ev-ahead-${i}`}>Book up to</FieldLabel>
                      <select id={`ev-ahead-${i}`} value={e.maxDaysAhead} onChange={(x) => setEvent(i, { maxDaysAhead: Number(x.target.value) })} className={selectCls}>
                        {AHEAD.map((d) => (
                          <option key={d} value={d}>
                            {d} days ahead
                          </option>
                        ))}
                        {!AHEAD.includes(e.maxDaysAhead) && <option value={e.maxDaysAhead}>{e.maxDaysAhead} days ahead</option>}
                      </select>
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`ev-desc-${i}`}>Description (optional)</FieldLabel>
                    <textarea
                      id={`ev-desc-${i}`}
                      value={e.description ?? ""}
                      maxLength={500}
                      rows={2}
                      onChange={(x) => setEvent(i, { description: x.target.value })}
                      className={cx(fieldCls, "py-3 leading-6")}
                    />
                  </div>
                  <Switch
                    checked={e.active}
                    onChange={(v) => setEvent(i, { active: v })}
                    label="Accepting bookings"
                    description={e.active ? "Guests can pick a time." : "Hidden from your booking page."}
                  />
                  {savedHandle && e.id && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                      <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={linkFor(e.slug)}>
                        /book/{savedHandle}/{e.slug}
                      </span>
                      <Button icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => void copyLink(e.slug)}>
                        Copy link
                      </Button>
                      <Button icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={() => void shareLink(e.slug, e.title)}>
                        Share
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {events.length < 10 && (
                <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={addEvent}>
                  Add event type
                </Button>
              )}
              <p className="text-meta text-muted-foreground">Turn an event off to hide it. Existing bookings stay.</p>
            </div>
          </Panel>

          {formError && (
            <p className="text-meta text-danger" role="alert">
              {formError}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="primary" loading={saving} disabled={offline} onClick={() => void save()} className="sm:min-w-40">
              Save schedule
            </Button>
            {!savedHandle && <p className="text-meta text-muted-foreground">Save to get your booking link.</p>}
          </div>

          <Panel>
            <PanelHeader title="Upcoming bookings" meta={bookings ? String(bookings.length) : undefined} />
            {bookingsError ? (
              <p className="p-4 text-ui text-muted-foreground">{bookingsError}</p>
            ) : bookings === null ? (
              <div className="m-4 h-16 animate-pulse rounded-chip bg-muted" role="status" aria-busy="true">
                <span className="sr-only">Loading bookings</span>
              </div>
            ) : bookings.length === 0 ? (
              <div className="flex items-start gap-3 p-4 text-ui text-muted-foreground">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>No upcoming bookings. Share your link and they will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {bookings.map((b) => {
                  const title = `${b.eventTitle} with ${b.guestName}`;
                  return (
                    <li key={b.id} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 text-ui font-semibold">{b.guestName}</p>
                        <Badge tone="accent">{formatInZone(b.startAt, hostTz)}</Badge>
                      </div>
                      <p className="text-meta text-muted-foreground">
                        {b.eventTitle} · {b.guestEmail}
                      </p>
                      {b.guestNote && <p className="whitespace-pre-line text-ui">{b.guestNote}</p>}
                      {b.agenda && (
                        <details className="rounded-chip bg-muted px-3 py-2 text-meta">
                          <summary className="cursor-pointer font-semibold">Agenda</summary>
                          <p className="mt-1 whitespace-pre-line text-muted-foreground">{b.agenda}</p>
                        </details>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Link
                          href={`/?title=${encodeURIComponent(title)}`}
                          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10"
                        >
                          <Mic className="h-4 w-4" aria-hidden />
                          Record this meeting
                        </Link>
                        {confirmId === b.id ? (
                          <>
                            <Button variant="danger-solid" disabled={offline} onClick={() => void cancelBooking(b.id)}>
                              Confirm cancel
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmId(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button variant="danger" disabled={offline} icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setConfirmId(b.id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
