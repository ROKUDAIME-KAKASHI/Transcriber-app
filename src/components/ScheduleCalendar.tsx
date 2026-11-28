"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarCheck, CalendarClock, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, CloudOff, Link2, MapPin, Mic, Plus, Users, Video } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { useLocalUser } from "./SyncProvider";
import { useToast } from "./Toast";
import { Sheet } from "./Sheet";
import { MonthGrid, TimeGrid, KIND_STYLE } from "./CalendarViews";
import { FindATime } from "./FindATime";
import { ScheduleSettings, type ScheduleSection } from "./ScheduleSettings";
import { SeriesSettingsSheet } from "./SeriesSettingsSheet";
import { Badge, Button, Notice, Segmented, cx } from "./ui";
import { useConnectivity } from "@/lib/connectivity";
import { useFlag } from "@/lib/flagsClient";
import { isNative } from "@/lib/native";
import { listMeetings } from "@/lib/local/repo";
import { browserZone, loadBookings, loadPlans, loadTimeZone, readCalCache, type BookingDTO } from "@/lib/calendarCache";
import {
  CAL_KIND_LABEL, CAL_VIEWS, CAL_VIEW_LABEL, buildEvents, clockLabel, dayLabel, isCalView, isYmd, planHrefAt, rangeFor, rangeTitle, shiftAnchor, todayIn,
  type CalEvent, type CalView,
} from "@/lib/calendarView";
import { formatInZone, isValidTimeZone } from "@/lib/scheduling";
import { isHttpUrl, recordHref, type PlanDTO, type SeriesDTO } from "@/lib/planning";
import { deliverPlanIcs, openCallLink } from "@/lib/planActions";
import { useCalendarReady } from "@/lib/calendarClient";

type OptionKey = "link" | "hours" | "lengths" | "find" | "bookings" | "series";
const OPTION_KEYS: OptionKey[] = ["link", "hours", "lengths", "find", "bookings", "series"];
const OPTION_TITLE: Record<OptionKey, string> = {
  link: "Booking link",
  hours: "Weekly hours",
  lengths: "Meeting lengths",
  find: "Find a time",
  bookings: "Upcoming bookings",
  series: "Series",
};
const isOption = (v: unknown): v is OptionKey => typeof v === "string" && (OPTION_KEYS as string[]).includes(v);
const SECTION_OF: Partial<Record<OptionKey, ScheduleSection>> = { link: "link", hours: "hours", lengths: "lengths", bookings: "bookings" };

const FIND_DURATIONS = [15, 30, 45, 60];
const ROW = "flex min-h-11 w-full items-center gap-3 rounded-chip px-3 text-left text-ui hover:bg-muted";
const LINK_BTN = "inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted lg:min-h-10";

/** The Schedule page as a calendar: Month, Week, Day. Booking tools sit behind "Scheduling options". */
export function ScheduleCalendar() {
  const router = useRouter();
  const toast = useToast();
  const { user, cachedUser } = useAuth();
  const local = useLocalUser();
  const userId = local.userId ?? user?.id ?? cachedUser?.id ?? null;
  const online = useConnectivity() !== "offline";
  const plansOn = useFlag("plannedMeetings");
  const calOn = useFlag("calendar");
  const calReady = useCalendarReady(calOn && online && plansOn);

  const [view, setView] = useState<CalView | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [tz, setTz] = useState("UTC");
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [firstDone, setFirstDone] = useState(false);
  const [hadCache, setHadCache] = useState(false);
  const [openEvent, setOpenEvent] = useState<CalEvent | null>(null);
  const [slot, setSlot] = useState<{ ymd: string; min: number } | null>(null);
  const [option, setOption] = useState<OptionKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [series, setSeries] = useState<SeriesDTO[]>([]);
  const [seriesOpen, setSeriesOpen] = useState<SeriesDTO | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Start-up: the saved copy first, then the view and day (from the address if given), then a deep link to an options sheet.
  useEffect(() => {
    const cache = readCalCache(userId);
    const zone = cache.tz && isValidTimeZone(cache.tz) ? cache.tz : browserZone();
    setTz(zone);
    setPlans(cache.plans);
    setBookings(cache.bookings);
    setHadCache(cache.plans.length + cache.bookings.length > 0);
    const q = new URLSearchParams(window.location.search);
    const v = q.get("view");
    // Chosen once: a later change of account must not reset the view or day the user moved to.
    setView((cur) => cur ?? (isCalView(v) ? v : window.matchMedia("(min-width: 1024px)").matches ? "week" : "day"));
    const d = q.get("date");
    setAnchor((cur) => cur ?? (d && isYmd(d) ? d : todayIn(zone)));
  }, [userId]);

  // A link to an options sheet (/schedule?options=bookings): open it once, then take it out of the address.
  const optionParam = useSearchParams().get("options");
  useEffect(() => {
    if (!isOption(optionParam)) return;
    setOption(optionParam);
    const q = new URLSearchParams(window.location.search);
    q.delete("options");
    const rest = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, [optionParam]);

  // The saved time zone (the same one the booking page uses), else this device's.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void loadTimeZone(userId).then((z) => {
      if (!cancelled && z && isValidTimeZone(z)) setTz(z);
    });
    return () => {
      cancelled = true;
    };
  }, [online, userId]);

  // Series for the options menu (only shown when there are some).
  useEffect(() => {
    if (!online || !plansOn) return;
    let cancelled = false;
    void fetch("/api/series", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { series?: SeriesDTO[] } | null) => {
        if (!cancelled && j && Array.isArray(j.series)) setSeries(j.series);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online, plansOn, reloadTick]);

  const range = useMemo(() => (view && anchor ? rangeFor(view, anchor, tz) : null), [view, anchor, tz]);
  const fromMs = range?.fromMs ?? 0;
  const toMs = range?.toMs ?? 0;

  // Only the visible range. Planned meetings are filtered by the server (a day of slack catches meetings running past midnight).
  // Bookings come as "everything upcoming" because that endpoint has no range filter, and are placed on the client.
  useEffect(() => {
    if (!range) return;
    if (!online) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [p, b] = await Promise.all([plansOn ? loadPlans(userId, fromMs - 86_400_000, toMs) : Promise.resolve(null), loadBookings(userId)]);
      if (cancelled) return;
      const next = p ?? b;
      if (next) {
        setPlans(p?.plans ?? next.plans);
        setBookings(b?.bookings ?? next.bookings);
      }
      setFailed(!p && !b && plansOn);
      setLoading(false);
      setFirstDone(true);
    })();
    return () => {
      cancelled = true;
    };
    // range is derived from view, anchor and tz; fromMs and toMs stand for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMs, toMs, online, plansOn, userId, reloadTick]);

  // Back in the app: refresh quietly.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setReloadTick((n) => n + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const meetings = useLiveQuery(async () => (userId ? await listMeetings(userId) : []), [userId]);
  const events = useMemo(
    () => buildEvents({ plans, bookings, meetings: (meetings ?? []).map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt, durationSec: m.durationSec, deleted: m.deleted })) }),
    [plans, bookings, meetings]
  );
  const visible = useMemo(() => (range ? events.filter((e) => e.startMs < range.toMs && e.endMs > range.fromMs) : []), [events, range]);

  // Options menu: closes on outside press, Esc and route change.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const today = todayIn(tz);
  const go = useCallback((dir: -1 | 1) => view && anchor && setAnchor(shiftAnchor(view, anchor, dir)), [view, anchor]);
  const openDay = (ymd: string) => {
    setAnchor(ymd);
    setView("day");
  };
  const pickOption = (k: OptionKey) => {
    setMenuOpen(false);
    if (k === "series" && series.length === 1) {
      setSeriesOpen(series[0]);
      return;
    }
    setOption(k);
  };

  const showFind = calOn && plansOn && calReady;
  const items: { key: OptionKey; label: string; icon: typeof Link2 }[] = [
    { key: "link", label: "Booking link", icon: Link2 },
    { key: "hours", label: "Weekly hours", icon: CalendarClock },
    { key: "lengths", label: "Meeting lengths", icon: CalendarCheck },
    ...(showFind ? [{ key: "find" as const, label: "Find a time", icon: CalendarPlus }] : []),
    { key: "bookings", label: "Upcoming bookings", icon: Users },
    ...(series.length > 0 ? [{ key: "series" as const, label: "Series", icon: CalendarClock }] : []),
  ];

  const skeleton = !range || (loading && !firstDone && !hadCache && events.length === 0);
  const noEvents = !!range && !skeleton && !loading && visible.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Schedule</h1>
        <Link
          href="/plan?new=1"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-btn bg-accent px-3 text-ui font-semibold text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Plan
        </Link>
        <div ref={menuRef} className="relative">
          <Button variant="secondary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            Scheduling options
            <ChevronDown className={cx("h-4 w-4 transition-transform", menuOpen && "rotate-180")} aria-hidden />
          </Button>
          {menuOpen && (
            <div role="menu" aria-label="Scheduling options" className="pop-in absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-panel border border-border bg-card p-1.5 shadow-float">
              {items.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" role="menuitem" onClick={() => pickOption(key)} className={ROW}>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setAnchor(todayIn(tz))} disabled={!view}>
          Today
        </Button>
        <div className="flex items-center">
          <button type="button" onClick={() => go(-1)} aria-label={`Previous ${view ?? "period"}`} className="grid h-11 w-11 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground lg:h-10 lg:w-10">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" onClick={() => go(1)} aria-label={`Next ${view ?? "period"}`} className="grid h-11 w-11 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground lg:h-10 lg:w-10">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-ui font-semibold" aria-live="polite">
          {range ? rangeTitle(range) : ""}
        </h2>
        <Segmented
          label="Calendar view"
          className="w-full sm:w-64"
          value={view ?? "week"}
          onChange={(v) => setView(v)}
          options={CAL_VIEWS.map((v) => ({ value: v, label: CAL_VIEW_LABEL[v] }))}
        />
      </div>

      {!online && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="You're offline">
          {hadCache
            ? "Showing the planned and booked meetings this device saved, and your recorded meetings."
            : "No planned or booked meetings are saved on this device yet. Your recorded meetings still show. Connect to see the rest."}
        </Notice>
      )}
      {online && failed && (
        <Notice tone="danger" title="Couldn't load your calendar">
          <p>Check the connection and try again.</p>
          <Button className="mt-3" onClick={() => setReloadTick((n) => n + 1)}>
            Try again
          </Button>
        </Notice>
      )}

      <div aria-busy={loading} className="relative">
        {online && loading && firstDone && <span className="absolute inset-x-0 -top-2 z-30 h-0.5 animate-pulse rounded bg-accent" aria-hidden />}
        {skeleton ? (
          <div role="status" aria-busy="true" className="space-y-2">
            <span className="sr-only">Loading your calendar</span>
            <div className="h-12 animate-pulse rounded-panel bg-muted" />
            <div className="h-80 animate-pulse rounded-panel bg-muted" />
          </div>
        ) : range && view === "month" ? (
          <>
            <MonthGrid range={range} events={events} tz={tz} today={today} onOpenEvent={setOpenEvent} onOpenDay={openDay} />
            {noEvents && <p className="mt-3 text-center text-ui text-muted-foreground">Nothing in {rangeTitle(range)}. Tap a day to plan a meeting.</p>}
          </>
        ) : range ? (
          <TimeGrid
            range={range}
            events={events}
            tz={tz}
            today={today}
            onOpenEvent={setOpenEvent}
            onPickSlot={(ymd, min) => setSlot({ ymd, min })}
            onOpenDay={openDay}
            empty={noEvents}
          />
        ) : null}
      </div>

      <Legend />

      {openEvent && (
        <EventSheet
          event={openEvent}
          tz={tz}
          plan={openEvent.planId ? plans.find((p) => p.id === openEvent.planId) ?? null : null}
          onClose={() => setOpenEvent(null)}
          onOpenBookings={() => {
            setOpenEvent(null);
            setOption("bookings");
          }}
          toast={toast}
        />
      )}

      {slot && (
        <Sheet title="Plan a meeting here?" subtitle={`${dayLabel(slot.ymd, { weekday: "long", day: "numeric", month: "long" })}, ${clockLabel(slot.min)}`} onClose={() => setSlot(null)}>
          <p className="text-meta text-muted-foreground">Opens a new planned meeting with this day and time filled in ({tz.replace(/_/g, " ")}).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={planHrefAt(slot.ymd, slot.min, tz)} className="inline-flex min-h-12 items-center gap-2 rounded-btn bg-accent px-4 text-ui font-semibold text-accent-foreground hover:bg-accent/90 lg:min-h-10">
              <CalendarPlus className="h-4 w-4" aria-hidden /> Plan a meeting here
            </Link>
            <Button variant="ghost" onClick={() => setSlot(null)}>
              Not now
            </Button>
          </div>
        </Sheet>
      )}

      {option && option !== "find" && option !== "series" && (
        <Sheet title={OPTION_TITLE[option]} size="md" onClose={() => setOption(null)}>
          <ScheduleSettings section={SECTION_OF[option] ?? "all"} />
        </Sheet>
      )}
      {option === "find" && (
        <FindSheet
          tz={tz}
          onClose={() => setOption(null)}
          onPick={(date, time) => {
            setOption(null);
            router.push(`/plan?${new URLSearchParams({ new: "1", date, time, tz })}`);
          }}
        />
      )}
      {option === "series" && (
        <Sheet title="Series" subtitle="Pick one to change how often it repeats" onClose={() => setOption(null)}>
          <ul className="space-y-1">
            {series.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={ROW}
                  onClick={() => {
                    setOption(null);
                    setSeriesOpen(s);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{s.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {seriesOpen && (
        <SeriesSettingsSheet
          series={seriesOpen}
          calendarOn={calOn}
          offline={!online}
          onChanged={(s) => setSeries((list) => list.map((x) => (x.id === s.id ? s : x)))}
          onClose={() => setSeriesOpen(null)}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground" aria-label="Colour key">
      {(["plan", "booking", "recorded"] as const).map((k) => {
        const Icon = KIND_STYLE[k].icon;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={cx("inline-flex h-5 w-5 items-center justify-center rounded-chip border-l-4", KIND_STYLE[k].chip)}>
              <Icon className="h-3 w-3" aria-hidden />
            </span>
            {CAL_KIND_LABEL[k]}
          </li>
        );
      })}
    </ul>
  );
}

function FindSheet({ tz, onClose, onPick }: { tz: string; onClose: () => void; onPick: (date: string, time: string) => void }) {
  const [duration, setDuration] = useState(30);
  return (
    <Sheet title="Find a time" subtitle="When you are free, in the next 14 days" size="md" onClose={onClose}>
      <div role="group" aria-label="Meeting length" className="mb-3 flex flex-wrap gap-2">
        {FIND_DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={duration === d}
            onClick={() => setDuration(d)}
            className={cx(
              "inline-flex min-h-12 min-w-12 items-center justify-center rounded-chip border px-3 text-ui font-semibold transition-colors lg:min-h-10",
              duration === d ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
            )}
          >
            {d} min
          </button>
        ))}
      </div>
      <FindATime attendees={[]} durationMin={duration} timeZone={tz} onPick={onPick} />
    </Sheet>
  );
}

function EventSheet({
  event: e,
  tz,
  plan,
  onClose,
  onOpenBookings,
  toast,
}: {
  event: CalEvent;
  tz: string;
  plan: PlanDTO | null;
  onClose: () => void;
  onOpenBookings: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const st = KIND_STYLE[e.kind];
  const Icon = st.icon;
  const mins = Math.round((e.endMs - e.startMs) / 60_000);
  const [busy, setBusy] = useState(false);
  const callOk = !!e.callUrl && isHttpUrl(e.callUrl);

  const ics = async () => {
    if (!e.planId) return;
    setBusy(true);
    try {
      const r = await deliverPlanIcs(e.planId, e.title);
      if (r === "ok") toast("Calendar file ready", "success");
    } catch {
      toast("Couldn't make the calendar file. Try again.", "danger");
    } finally {
      setBusy(false);
    }
  };

  const canRecord = !e.recorded && e.kind !== "recorded";
  const recordLink = e.planId ? recordHref({ id: e.planId, title: e.title }) : `/?title=${encodeURIComponent(e.title.slice(0, 120))}`;

  return (
    <Sheet title={e.title} onClose={onClose}>
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={e.kind === "booking" ? "success" : e.kind === "plan" ? "accent" : "neutral"}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {CAL_KIND_LABEL[e.kind]}
          </Badge>
          {e.kind === "plan" && plan?.series && <span className="text-meta text-muted-foreground">Series: {plan.series.title}</span>}
        </p>
        <p className="num text-ui">
          {formatInZone(new Date(e.startMs), tz)} to {formatInZone(new Date(e.endMs), tz, false)}
          <span className="block text-meta text-muted-foreground">
            {mins} min · {tz.replace(/_/g, " ")}
          </span>
        </p>
        {e.venue && (
          <p className="flex items-start gap-2 text-ui">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Venue" role="img" />
            <span className="min-w-0 break-words">{e.venue}</span>
          </p>
        )}
        {callOk && (
          <p className="flex items-start gap-2 text-ui">
            <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Call link" role="img" />
            <a
              href={e.callUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(ev) => {
                if (!isNative()) return;
                ev.preventDefault();
                void openCallLink(e.callUrl as string);
              }}
              className="min-w-0 break-all font-semibold text-accent-text underline underline-offset-2"
            >
              Join the call
            </a>
          </p>
        )}
        {e.attendees.length > 0 && (
          <p className="flex items-start gap-2 text-ui">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Attendees" role="img" />
            <span className="min-w-0 break-words">{e.attendees.join(", ")}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {canRecord && (
            <Link href={recordLink} className="inline-flex min-h-12 items-center gap-2 rounded-btn bg-accent px-4 text-ui font-semibold text-accent-foreground hover:bg-accent/90 lg:min-h-10">
              <Mic className="h-4 w-4" aria-hidden /> Record now
            </Link>
          )}
          {e.meetingId && (e.recorded || e.kind === "recorded") && (
            <Link href={`/meeting?id=${encodeURIComponent(e.meetingId)}`} className={LINK_BTN}>
              Open meeting
            </Link>
          )}
          {e.planId && (
            <Link href={`/plan?id=${encodeURIComponent(e.planId)}`} className={LINK_BTN}>
              Open plan
            </Link>
          )}
          {e.planId && (
            <Button variant="secondary" loading={busy} onClick={() => void ics()}>
              Invite (.ics)
            </Button>
          )}
          {e.bookingId && !e.planId && (
            <Button variant="secondary" onClick={onOpenBookings}>
              Open bookings
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
