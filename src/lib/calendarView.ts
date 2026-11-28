import { addDays, weekdayMon0 } from "./trackerPlus.ts";
import { dayKey, isValidTimeZone, wallClockOf, zonedToUtc } from "./scheduling.ts";

/**
 * Pure helpers for the Schedule calendar (Month, Week, Day): date ranges, the time grid, overlap layout and
 * merging plans, bookings and recorded meetings into one list. No React or database imports, so node:test can
 * load this file. Days are "YYYY-MM-DD" strings in the user's time zone. Weeks run Monday to Sunday.
 */

export type CalView = "month" | "week" | "day";
export const CAL_VIEWS: readonly CalView[] = ["month", "week", "day"];
export const CAL_VIEW_LABEL: Record<CalView, string> = { month: "Month", week: "Week", day: "Day" };
export const isCalView = (v: unknown): v is CalView => typeof v === "string" && (CAL_VIEWS as readonly string[]).includes(v);

export type CalKind = "plan" | "booking" | "recorded";
export const CAL_KIND_LABEL: Record<CalKind, string> = { plan: "Planned", booking: "Booked", recorded: "Recorded" };

/** Smallest height an event gets on the grid, in minutes, so a 5 minute meeting can still be tapped. */
export const MIN_SEGMENT_MIN = 25;
export const SLOT_STEP_MIN = 30;

const p2 = (n: number) => String(n).padStart(2, "0");
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isYmd = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

function parts(ymd: string): { y: number; m: number; d: number } {
  const m = YMD_RE.exec(ymd)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Today's day in a zone. */
export function todayIn(tz: string, nowMs: number = Date.now()): string {
  return dayKey(new Date(nowMs), tz);
}

/** The first instant of a day in a zone. A zone that skips midnight (some DST changes) starts at the first hour that exists. */
export function dayStartMs(ymd: string, tz: string): number {
  const { y, m, d } = parts(ymd);
  for (let h = 0; h < 4; h++) {
    const t = zonedToUtc({ y, m, d, h, min: 0 }, tz);
    if (t !== null) return t;
  }
  return Date.UTC(y, m - 1, d);
}

export function minutesOfDay(ms: number, tz: string): number {
  const w = wallClockOf(ms, tz);
  return w.h * 60 + w.min;
}

/* ---------- ranges ---------- */

export interface CalRange {
  view: CalView;
  anchor: string;
  /** Every day shown, in order (month: whole weeks, so 28 to 42 days). */
  days: string[];
  fromMs: number;
  toMs: number;
}

export function rangeFor(view: CalView, anchor: string, tz: string): CalRange {
  let days: string[];
  if (view === "day") {
    days = [anchor];
  } else if (view === "week") {
    const start = addDays(anchor, -weekdayMon0(anchor));
    days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  } else {
    const { y, m } = parts(anchor);
    const first = `${y}-${p2(m)}-01`;
    const lead = weekdayMon0(first);
    const weeks = Math.ceil((lead + daysInMonth(y, m)) / 7);
    const start = addDays(first, -lead);
    days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  }
  return { view, anchor, days, fromMs: dayStartMs(days[0], tz), toMs: dayStartMs(addDays(days[days.length - 1], 1), tz) };
}

/** Back (-1) or forward (+1) by one month, week or day. Month moves land on the 1st. */
export function shiftAnchor(view: CalView, anchor: string, dir: -1 | 1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  const { y, m } = parts(anchor);
  const t = y * 12 + (m - 1) + dir;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}-01`;
}

const fmtUtc = (ymd: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T00:00:00Z`));

/** "November 2026", "23 – 29 Nov 2026", "30 Nov – 6 Dec 2026", "Sat 28 Nov 2026". */
export function rangeTitle(r: CalRange): string {
  if (r.view === "month") return fmtUtc(r.anchor, { month: "long", year: "numeric" });
  if (r.view === "day") return fmtUtc(r.anchor, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const a = r.days[0];
  const b = r.days[r.days.length - 1];
  const ya = parts(a).y;
  const yb = parts(b).y;
  if (ya !== yb) return `${fmtUtc(a, { day: "numeric", month: "short", year: "numeric" })} – ${fmtUtc(b, { day: "numeric", month: "short", year: "numeric" })}`;
  if (parts(a).m === parts(b).m) return `${parts(a).d} – ${fmtUtc(b, { day: "numeric", month: "short" })} ${yb}`;
  return `${fmtUtc(a, { day: "numeric", month: "short" })} – ${fmtUtc(b, { day: "numeric", month: "short" })} ${yb}`;
}

export const dayLabel = (ymd: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => fmtUtc(ymd, o);

/** "9 am", "12 pm" for the hour gutter. */
export function hourLabel(h: number): string {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${h < 12 ? "am" : "pm"}`;
}

/* ---------- events ---------- */

export interface CalEvent {
  /** Unique across kinds. */
  key: string;
  kind: CalKind;
  title: string;
  startMs: number;
  endMs: number;
  planId: string | null;
  meetingId: string | null;
  bookingId: string | null;
  /** A plan that is already recorded (open the meeting instead of recording). */
  recorded: boolean;
  venue: string | null;
  callUrl: string | null;
  attendees: string[];
}

export interface PlanLike {
  id: string;
  title: string;
  startAt: string;
  durationMin: number;
  status: "PLANNED" | "RECORDED" | "CANCELLED";
  venue: string | null;
  callUrl: string | null;
  meetingId: string | null;
  bookingId: string | null;
  attendees: { name: string; email: string | null }[];
}

export interface BookingLike {
  id: string;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  eventTitle: string;
  meetingId: string | null;
}

export interface MeetingLike {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number;
  deleted?: 0 | 1;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * One list for the calendar. A plan that came from a booking is shown once, as "Booked". A booking with no plan
 * is shown on its own. A recorded meeting that a plan or booking already points at is hidden, because the plan
 * or booking stands for it. Cancelled plans are left out. Sorted by start, then end.
 */
export function buildEvents(i: { plans: PlanLike[]; bookings: BookingLike[]; meetings: MeetingLike[] }): CalEvent[] {
  const out: CalEvent[] = [];
  const bookingPlans = new Set<string>();
  const linkedMeetings = new Set<string>();
  for (const p of i.plans) {
    if (p.status === "CANCELLED") continue;
    if (p.bookingId) bookingPlans.add(p.bookingId);
    if (p.meetingId) linkedMeetings.add(p.meetingId);
    out.push({
      key: `plan:${p.id}`,
      kind: p.bookingId ? "booking" : "plan",
      title: p.title,
      startMs: ms(p.startAt),
      endMs: ms(p.startAt) + p.durationMin * 60_000,
      planId: p.id,
      meetingId: p.meetingId,
      bookingId: p.bookingId,
      recorded: p.status === "RECORDED" && !!p.meetingId,
      venue: p.venue,
      callUrl: p.callUrl,
      attendees: p.attendees.map((a) => a.name),
    });
  }
  for (const b of i.bookings) {
    if (b.meetingId) linkedMeetings.add(b.meetingId);
    if (bookingPlans.has(b.id)) continue;
    out.push({
      key: `booking:${b.id}`,
      kind: "booking",
      title: `${b.eventTitle} with ${b.guestName}`,
      startMs: ms(b.startAt),
      endMs: ms(b.endAt),
      planId: null,
      meetingId: b.meetingId,
      bookingId: b.id,
      recorded: !!b.meetingId,
      venue: null,
      callUrl: null,
      attendees: [`${b.guestName} <${b.guestEmail}>`],
    });
  }
  for (const m of i.meetings) {
    if (m.deleted === 1 || linkedMeetings.has(m.id)) continue;
    const start = ms(m.createdAt);
    if (Number.isNaN(start)) continue;
    out.push({
      key: `meeting:${m.id}`,
      kind: "recorded",
      title: m.title || "Untitled meeting",
      startMs: start,
      endMs: start + Math.max(m.durationSec * 1000, 15 * 60_000),
      planId: null,
      meetingId: m.id,
      bookingId: null,
      recorded: true,
      venue: null,
      callUrl: null,
      attendees: [],
    });
  }
  return out.filter((e) => !Number.isNaN(e.startMs) && !Number.isNaN(e.endMs)).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Events that touch a day (a meeting past midnight shows on both days). */
export function eventsOnDay(events: CalEvent[], ymd: string, tz: string): CalEvent[] {
  const a = dayStartMs(ymd, tz);
  const b = dayStartMs(addDays(ymd, 1), tz);
  return events.filter((e) => e.startMs < b && Math.max(e.endMs, e.startMs + 1) > a);
}

/* ---------- grid layout ---------- */

export interface Seg {
  event: CalEvent;
  startMin: number;
  endMin: number;
  /** Side-by-side column and how many columns share this cluster of overlaps. */
  col: number;
  cols: number;
}

/**
 * Side-by-side layout. Events that overlap, directly or through a chain, form a cluster; inside it each event
 * takes the first free column, and every event in the cluster gets the same column count.
 */
export function layoutOverlaps<T extends { startMin: number; endMin: number }>(items: T[]): (T & { col: number; cols: number })[] {
  const sorted = items.slice().sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) c.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.endMin);
    } else {
      colEnds[col] = it.endMin;
    }
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

/** The pieces of events that fall on one day, as minutes from the start of that day, with overlap columns. */
export function segmentsForDay(events: CalEvent[], ymd: string, tz: string): Seg[] {
  const a = dayStartMs(ymd, tz);
  const b = dayStartMs(addDays(ymd, 1), tz);
  const raw = eventsOnDay(events, ymd, tz).map((event) => {
    const startMin = event.startMs <= a ? 0 : minutesOfDay(event.startMs, tz);
    let endMin = event.endMs >= b ? 1440 : minutesOfDay(event.endMs, tz);
    if (endMin <= startMin) endMin = Math.min(1440, startMin + MIN_SEGMENT_MIN);
    endMin = Math.max(endMin, Math.min(1440, startMin + MIN_SEGMENT_MIN));
    return { event, startMin, endMin };
  });
  return layoutOverlaps(raw);
}

/** Minutes from the top of a day column to a click, snapped down to the slot step and kept inside the day. */
export function slotMinutes(offsetPx: number, hourPx: number, step = SLOT_STEP_MIN): number {
  const raw = (offsetPx / hourPx) * 60;
  const m = Math.floor(raw / step) * step;
  return Math.max(0, Math.min(1440 - step, m));
}

export const timeText = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;

/** "9:30 am" for a minute of the day. */
export function clockLabel(min: number): string {
  const h = Math.floor(min / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${p2(min % 60)} ${h < 12 ? "am" : "pm"}`;
}

/** The "Plan a meeting" address for an empty slot. The Plan page reads date, time and tz. */
export function planHrefAt(ymd: string, min: number, tz: string): string {
  const q = new URLSearchParams({ new: "1", date: ymd, time: timeText(min), tz });
  return `/plan?${q}`;
}

/** Date, time and zone from a plan address, ignoring anything malformed. */
export function prefillFromParams(get: (k: string) => string | null): { date?: string; time?: string; timeZone?: string } {
  const date = get("date");
  const time = get("time");
  const tz = get("tz");
  const out: { date?: string; time?: string; timeZone?: string } = {};
  if (date && isYmd(date)) out.date = date;
  if (time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) out.time = time;
  if (tz && isValidTimeZone(tz)) out.timeZone = tz;
  if (!out.date || !out.time) return out.timeZone ? { timeZone: out.timeZone } : {};
  return out;
}

/** The red "now" line: which day and how many minutes into it. */
export function nowPosition(nowMs: number, tz: string): { ymd: string; min: number } {
  return { ymd: dayKey(new Date(nowMs), tz), min: minutesOfDay(nowMs, tz) };
}

/* ---------- offline copy ---------- */

/** Merges two lists by id, fresh rows win; keeps the `cap` latest by start so storage stays small. */
export function mergeById<T extends { id: string; startAt: string }>(old: T[], fresh: T[], cap = 300): T[] {
  const map = new Map<string, T>();
  for (const x of old) map.set(x.id, x);
  for (const x of fresh) map.set(x.id, x);
  return [...map.values()].sort((a, b) => ms(b.startAt) - ms(a.startAt)).slice(0, cap);
}

/**
 * A fresh answer for a time window replaces what the copy held for that window, so a meeting deleted or moved
 * elsewhere disappears; rows outside the window are kept.
 */
export function replaceInWindow<T extends { id: string; startAt: string }>(old: T[], fresh: T[], fromMs: number, toMs: number, cap = 300): T[] {
  const outside = old.filter((x) => {
    const t = ms(x.startAt);
    return t < fromMs || t > toMs;
  });
  return mergeById(outside, fresh, cap);
}
