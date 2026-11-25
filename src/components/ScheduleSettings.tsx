"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, CloudOff, Copy, Mic, Share2 } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { useConnectivity } from "@/lib/connectivity";
import { copyText, shareText } from "@/lib/export/deliver";
import { findRepeatBookings } from "@/lib/dedupe";
import { DURATIONS, formatInZone, validateHandle, type AvailabilityRange } from "@/lib/scheduling";
import {
  DEFAULT_DAYS, DEFAULT_END, DEFAULT_OPTIONS, DEFAULT_START, WEEK, applyLengths, availabilityFromSimple, handleWithDigits,
  lengthsFromEvents, optionsFromEvents, simpleHoursFromAvailability, suggestHandle, type EventLike, type MoreOptions,
} from "@/lib/scheduleSimple";
import { useToast } from "./Toast";
import { Badge, Button, FieldLabel, Notice, Panel, PanelHeader, cx, inputCls, selectCls } from "./ui";

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

const chipCls = (on: boolean) =>
  cx(
    "inline-flex min-h-12 min-w-12 items-center justify-center rounded-chip border px-3 text-ui font-semibold transition-colors lg:min-h-10",
    on ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
  );

function bookingWhen(b: BookingRow, tz: string) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(b.startAt));
  const mins = Math.round((new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000);
  return `${date} · ${formatInZone(b.startAt, tz, false)} · ${b.guestName} (${mins} min)`;
}

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
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleTouched, setHandleTouched] = useState(false);
  const [tz, setTz] = useState("UTC");
  const [editingTz, setEditingTz] = useState(false);
  const [dayOn, setDayOn] = useState<number[]>(DEFAULT_DAYS);
  const [startMin, setStartMin] = useState(DEFAULT_START);
  const [endMin, setEndMin] = useState(DEFAULT_END);
  const [custom, setCustom] = useState<AvailabilityRange[] | null>(null);
  const [lengths, setLengths] = useState<number[]>([30]);
  const [opts, setOpts] = useState<MoreOptions>(DEFAULT_OPTIONS);
  const [events, setEvents] = useState<EventLike[]>([]);
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const zones = useMemo(() => timeZones(tz), [tz]);

  const loadBookings = useCallback(async () => {
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
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
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
        setHandleTouched(false);
        setTz(data.timeZone ?? browserTz);
        const av = data.availability as AvailabilityRange[];
        const simple = simpleHoursFromAvailability(av);
        if (simple) {
          setCustom(null);
          setDayOn(simple.days);
          setStartMin(simple.startMin);
          setEndMin(simple.endMin);
        } else {
          setCustom(av);
        }
        const evs = data.eventTypes as EventLike[];
        setEvents(evs);
        // A brand-new account gets the default 30 minute event; a saved one shows exactly what is on.
        setLengths(data.saved ? lengthsFromEvents(evs) : [30]);
        setOpts(optionsFromEvents(evs));
        void loadBookings();
      } catch {
        setLoadError("Couldn't reach the server. Check the connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [browserTz, email, loadBookings]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDay = (n: number) => setDayOn((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
  const toggleLength = (d: number) => setLengths((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d].sort((a, b) => a - b)));

  const put = async (h: string) => {
    const availability = custom ?? availabilityFromSimple({ days: dayOn, startMin, endMin });
    return fetch("/api/schedule/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: h, timeZone: tz, availability, eventTypes: applyLengths(events, lengths, opts) }),
    });
  };

  const save = async () => {
    setFormError(null);
    const v = validateHandle(handle);
    if (!v.ok) {
      setEditingHandle(true);
      setFormError(v.error);
      return;
    }
    if (!custom && dayOn.length === 0) {
      setFormError("Pick at least one day people can book.");
      return;
    }
    if (!custom && !(startMin < endMin)) {
      setFormError("The end time must be after the start time.");
      return;
    }
    if (lengths.length === 0) {
      setFormError("Pick at least one meeting length.");
      return;
    }
    setSaving(true);
    try {
      let h = v.handle;
      let res = await put(h);
      // A handle we suggested may already be taken: try it with a few digits on the end.
      for (let attempt = 0; res.status === 409 && !handleTouched && !savedHandle && attempt < 4; attempt++) {
        h = handleWithDigits(v.handle, attempt);
        res = await put(h);
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) setEditingHandle(true);
        setFormError(data?.error || "Couldn't save. Try again.");
        return;
      }
      setEditingHandle(false);
      toast("Saved", "success");
      await load(true);
    } catch {
      setFormError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const link = savedHandle ? `${typeof window === "undefined" ? "" : window.location.origin}/book/${savedHandle}` : "";
  const copyLink = async () => {
    try {
      await copyText(link);
      toast("Booking link copied", "success");
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.", "danger");
    }
  };
  const shareLink = async () => {
    try {
      const r = await shareText(link, "Book a time with me");
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
  const repeatGuests = useMemo(() => findRepeatBookings(bookings ?? [], hostTz), [bookings, hostTz]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="Scheduling needs internet">
          Connect to the internet to change your schedule or see bookings.
        </Notice>
      )}

      {loading ? (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">Loading</span>
          <div className="h-28 animate-pulse rounded-panel bg-muted" />
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
            <PanelHeader title="Your booking link">
              {!editingHandle && (
                <button type="button" className="min-h-11 px-2 text-meta font-semibold text-accent" onClick={() => setEditingHandle(true)}>
                  Change
                </button>
              )}
            </PanelHeader>
            <div className="space-y-3 p-4">
              {editingHandle ? (
                <div>
                  <FieldLabel htmlFor="sch-handle">Link name</FieldLabel>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-meta text-muted-foreground">/book/</span>
                    <input
                      id="sch-handle"
                      value={handle}
                      onChange={(e) => {
                        setHandle(e.target.value.toLowerCase());
                        setHandleTouched(true);
                      }}
                      maxLength={30}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-describedby="sch-handle-hint"
                      className={inputCls}
                    />
                  </div>
                  <p id="sch-handle-hint" className="mt-1 text-meta text-muted-foreground">
                    3 to 30 letters, numbers or hyphens. Guests see this, never your email.
                  </p>
                </div>
              ) : (
                <p className="break-all rounded-chip bg-muted px-3 py-3 text-ui font-semibold" data-testid="booking-link">
                  {savedHandle ? link : `/book/${handle || "your-name"}`}
                </p>
              )}
              {savedHandle && !editingHandle ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => void copyLink()}>
                    Copy
                  </Button>
                  <Button variant="secondary" icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={() => void shareLink()}>
                    Share
                  </Button>
                </div>
              ) : (
                !savedHandle && <p className="text-meta text-muted-foreground">Check the times below, then tap Create my link.</p>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="When can people book?" />
            <div className="space-y-4 p-4">
              {custom ? (
                <div className="flex flex-wrap items-center gap-3 rounded-chip bg-muted px-3 py-2">
                  <p className="min-w-0 flex-1 text-ui">
                    <span className="font-semibold">Custom hours</span>
                    <span className="block text-meta text-muted-foreground">Different times on different days.</span>
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCustom(null);
                      setDayOn(DEFAULT_DAYS);
                      setStartMin(DEFAULT_START);
                      setEndMin(DEFAULT_END);
                    }}
                  >
                    Reset to simple
                  </Button>
                </div>
              ) : (
                <>
                  <div role="group" aria-label="Days people can book" className="flex flex-wrap gap-2">
                    {WEEK.map((w) => (
                      <button key={w.n} type="button" aria-pressed={dayOn.includes(w.n)} aria-label={w.label} onClick={() => toggleDay(w.n)} className={chipCls(dayOn.includes(w.n))}>
                        {w.short}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      aria-label="From"
                      value={toTime(startMin)}
                      onChange={(e) => !Number.isNaN(fromTime(e.target.value)) && setStartMin(fromTime(e.target.value))}
                      className={cx(inputCls, "!w-32")}
                    />
                    <span className="text-meta text-muted-foreground" aria-hidden>
                      to
                    </span>
                    <input
                      type="time"
                      aria-label="To"
                      value={toTime(endMin)}
                      onChange={(e) => !Number.isNaN(fromTime(e.target.value)) && setEndMin(fromTime(e.target.value))}
                      className={cx(inputCls, "!w-32")}
                    />
                  </div>
                </>
              )}
              <div>
                <p className="text-meta text-muted-foreground">
                  Times in {tz.replace(/_/g, " ")} ·{" "}
                  <button type="button" className="font-semibold text-accent" onClick={() => setEditingTz((v) => !v)} aria-expanded={editingTz}>
                    Change
                  </button>
                </p>
                {editingTz && (
                  <div className="mt-2 space-y-1">
                    <label htmlFor="sch-tz" className="sr-only">
                      Time zone
                    </label>
                    <select id="sch-tz" value={tz} onChange={(e) => setTz(e.target.value)} className={selectCls}>
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    {tz !== browserTz && (
                      <button type="button" className="text-meta font-semibold text-accent" onClick={() => setTz(browserTz)}>
                        Use this device&apos;s zone ({browserTz.replace(/_/g, " ")})
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Meeting length" />
            <div className="space-y-3 p-4">
              <div role="group" aria-label="Meeting lengths" className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" aria-pressed={lengths.includes(d)} onClick={() => toggleLength(d)} className={chipCls(lengths.includes(d))}>
                    {d} min
                  </button>
                ))}
              </div>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-ui font-semibold text-accent [&::-webkit-details-marker]:hidden">
                  More options
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="grid gap-3 pt-2 sm:grid-cols-3">
                  <div>
                    <FieldLabel htmlFor="opt-buf">Gap between meetings</FieldLabel>
                    <select id="opt-buf" value={opts.bufferMin} onChange={(e) => setOpts((o) => ({ ...o, bufferMin: Number(e.target.value) }))} className={selectCls}>
                      {BUFFERS.map((b) => (
                        <option key={b} value={b}>
                          {b === 0 ? "None" : `${b} minutes`}
                        </option>
                      ))}
                      {!BUFFERS.includes(opts.bufferMin) && <option value={opts.bufferMin}>{opts.bufferMin} minutes</option>}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="opt-notice">Minimum notice</FieldLabel>
                    <select id="opt-notice" value={opts.minNoticeMin} onChange={(e) => setOpts((o) => ({ ...o, minNoticeMin: Number(e.target.value) }))} className={selectCls}>
                      {NOTICES.map((n) => (
                        <option key={n.v} value={n.v}>
                          {n.l}
                        </option>
                      ))}
                      {!NOTICES.some((n) => n.v === opts.minNoticeMin) && <option value={opts.minNoticeMin}>{opts.minNoticeMin} minutes</option>}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="opt-ahead">Book up to</FieldLabel>
                    <select id="opt-ahead" value={opts.maxDaysAhead} onChange={(e) => setOpts((o) => ({ ...o, maxDaysAhead: Number(e.target.value) }))} className={selectCls}>
                      {AHEAD.map((d) => (
                        <option key={d} value={d}>
                          {d} days ahead
                        </option>
                      ))}
                      {!AHEAD.includes(opts.maxDaysAhead) && <option value={opts.maxDaysAhead}>{opts.maxDaysAhead} days ahead</option>}
                    </select>
                  </div>
                </div>
              </details>
            </div>
          </Panel>

          <div className="sticky bottom-[calc(92px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-10 space-y-2 lg:static">
            {formError && (
              <p className="rounded-chip bg-card px-3 py-2 text-meta text-danger shadow-card" role="alert">
                {formError}
              </p>
            )}
            <Button variant="primary" size="lg" loading={saving} disabled={offline} onClick={() => void save()} className="w-full sm:w-auto sm:min-w-40">
              {savedHandle ? "Save" : "Create my link"}
            </Button>
          </div>

          <Panel>
            <PanelHeader title="Upcoming" meta={bookings && bookings.length ? String(bookings.length) : undefined} />
            {bookingsError ? (
              <p className="p-4 text-ui text-muted-foreground">{bookingsError}</p>
            ) : bookings === null ? (
              <div className="m-4 h-16 animate-pulse rounded-chip bg-muted" role="status" aria-busy="true">
                <span className="sr-only">Loading bookings</span>
              </div>
            ) : bookings.length === 0 ? (
              <div className="flex items-start gap-3 p-4 text-ui text-muted-foreground">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>No bookings yet. Share your link to get started.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {bookings.map((b) => {
                  const open = openId === b.id;
                  const title = `${b.eventTitle} with ${b.guestName}`;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : b.id)}
                        className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 text-ui font-semibold">{bookingWhen(b, hostTz)}</span>
                        {repeatGuests.has(b.id) && <Badge tone="warning">Same guest booked twice</Badge>}
                        <ChevronDown className={cx("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
                      </button>
                      {open && (
                        <div className="space-y-2 px-4 pb-4">
                          <p className="text-meta text-muted-foreground">
                            {b.eventTitle} · {b.guestEmail}
                          </p>
                          {b.guestNote && <p className="whitespace-pre-line text-ui">{b.guestNote}</p>}
                          {b.agenda && (
                            <div className="rounded-chip bg-muted px-3 py-2 text-meta">
                              <p className="font-semibold">Agenda</p>
                              <p className="mt-1 whitespace-pre-line text-muted-foreground">{b.agenda}</p>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Link
                              href={`/?title=${encodeURIComponent(title)}`}
                              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10"
                            >
                              <Mic className="h-4 w-4" aria-hidden />
                              Record
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
                              <Button variant="danger" disabled={offline} onClick={() => setConfirmId(b.id)}>
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
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
