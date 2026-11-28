import { formatInZone, dayKey } from "./scheduling.ts";
import { recordHref } from "./planning.ts";
import type { BookingLike, PlanLike } from "./calendarView.ts";

/**
 * Pure builder for the notification panel. Everything is computed from data the app already loads (planned
 * meetings, bookings, task counts, device-local action items), so there is no new service and no push. Read state
 * is a map of item id to the time it was marked read, kept per user on the device. No React or database imports.
 */

export type NotifKind = "soon" | "upcoming" | "booking" | "overdue" | "dueToday" | "followUp" | "review";

export interface NotifItem {
  /** Stable while the item stays the same; changes when it should count as new again (e.g. "soon"). */
  id: string;
  kind: NotifKind;
  text: string;
  /** The moment the relative time refers to, or null (counts such as overdue tasks). */
  atMs: number | null;
  href: string;
}

export interface NotifPlan extends PlanLike {
  seriesId: string | null;
}
export interface NotifBooking extends BookingLike {
  createdAt?: string;
}
export interface ReviewRow {
  meetingId: string;
  title: string;
  count: number;
  atMs: number;
}

export const SOON_MIN = 10;
export const UPCOMING_HOURS = 24;
export const NEW_BOOKING_DAYS = 3;
export const FOLLOW_UP_DAYS = 7;
export const REVIEW_DAYS = 7;
export const READ_KEEP_DAYS = 14;
export const READ_MAX = 300;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "in 8 min", "in 3 h", "in 2 d", "5 min ago", "just now". */
export function relativeTime(atMs: number, nowMs: number): string {
  const diff = atMs - nowMs;
  const abs = Math.abs(diff);
  if (abs < MIN) return "just now";
  const n = abs < HOUR ? Math.round(abs / MIN) : abs < DAY ? Math.round(abs / HOUR) : Math.round(abs / DAY);
  const unit = abs < HOUR ? "min" : abs < DAY ? "h" : "d";
  return diff > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** "today 3:30 pm", "tomorrow 9:00 am" or "Sat 29 Nov 9:00 am" in the user's zone. */
export function whenPhrase(startMs: number, nowMs: number, tz: string): string {
  const day = dayKey(new Date(startMs), tz);
  const time = formatInZone(new Date(startMs), tz, false);
  if (day === dayKey(new Date(nowMs), tz)) return `today ${time}`;
  if (day === dayKey(new Date(nowMs + DAY), tz)) return `tomorrow ${time}`;
  return formatInZone(new Date(startMs), tz);
}

/** Recorded plans from the last week that have no later planned meeting in their series (or with their title). */
export function followUpsToPlan(plans: NotifPlan[], nowMs: number): NotifPlan[] {
  return plans.filter((p) => {
    if (p.status !== "RECORDED" || !p.meetingId) return false;
    const start = ms(p.startAt);
    if (start > nowMs || nowMs - start > FOLLOW_UP_DAYS * DAY) return false;
    return !plans.some(
      (q) =>
        q.id !== p.id &&
        q.status === "PLANNED" &&
        ms(q.startAt) > start &&
        (p.seriesId ? q.seriesId === p.seriesId : !q.seriesId && q.title === p.title)
    );
  });
}

export interface BuildInput {
  nowMs: number;
  tz: string;
  plans: NotifPlan[];
  bookings: NotifBooking[];
  /** From the task summary; null when the tracker is off, offline or paused. */
  tasks: { overdue: number; dueToday: number } | null;
  today: string;
  reviews: ReviewRow[];
}

/** The panel's items, most urgent first. */
export function buildNotifications(i: BuildInput): NotifItem[] {
  const out: NotifItem[] = [];
  const { nowMs, tz } = i;

  // Meetings starting in the next 24 hours (plans, and bookings that have no plan).
  const starts: { id: string; title: string; startMs: number; href: string }[] = [];
  const planBookings = new Set<string>();
  for (const p of i.plans) {
    if (p.bookingId) planBookings.add(p.bookingId);
    const s = ms(p.startAt);
    if (p.status === "PLANNED" && s >= nowMs && s <= nowMs + UPCOMING_HOURS * HOUR) {
      starts.push({ id: p.id, title: p.title, startMs: s, href: s - nowMs <= SOON_MIN * MIN ? recordHref(p) : `/plan?id=${encodeURIComponent(p.id)}` });
    }
  }
  for (const b of i.bookings) {
    if (planBookings.has(b.id) || b.meetingId) continue;
    const s = ms(b.startAt);
    if (s >= nowMs && s <= nowMs + UPCOMING_HOURS * HOUR) starts.push({ id: `b-${b.id}`, title: `${b.eventTitle} with ${b.guestName}`, startMs: s, href: "/schedule?options=bookings" });
  }
  starts.sort((a, b) => a.startMs - b.startMs);
  for (const s of starts) {
    const soon = s.startMs - nowMs <= SOON_MIN * MIN;
    out.push(
      soon
        ? { id: `soon:${s.id}`, kind: "soon", text: `Starting soon: ${s.title}`, atMs: s.startMs, href: s.href }
        : { id: `up:${s.id}`, kind: "upcoming", text: `${s.title}, ${whenPhrase(s.startMs, nowMs, tz)}`, atMs: s.startMs, href: s.href }
    );
  }

  // New bookings in the last few days that haven't happened yet.
  const fresh = i.bookings
    .filter((b) => b.createdAt && ms(b.endAt) >= nowMs && nowMs - ms(b.createdAt) <= NEW_BOOKING_DAYS * DAY)
    .sort((a, b) => ms(b.createdAt as string) - ms(a.createdAt as string));
  for (const b of fresh) {
    out.push({
      id: `booking:${b.id}`,
      kind: "booking",
      text: `New booking: ${b.guestName}, ${formatInZone(b.startAt, tz)}`,
      atMs: ms(b.createdAt as string),
      href: "/schedule?options=bookings",
    });
  }

  if (i.tasks && i.tasks.overdue > 0) {
    out.push({ id: `overdue:${i.today}:${i.tasks.overdue}`, kind: "overdue", text: `${plural(i.tasks.overdue, "task is", "tasks are")} overdue`, atMs: null, href: "/tasks?view=timeline" });
  }
  if (i.tasks && i.tasks.dueToday > 0) {
    out.push({ id: `due:${i.today}:${i.tasks.dueToday}`, kind: "dueToday", text: `${plural(i.tasks.dueToday, "task is", "tasks are")} due today`, atMs: null, href: "/tasks?view=timeline" });
  }

  for (const p of followUpsToPlan(i.plans, nowMs)) {
    out.push({ id: `follow:${p.id}`, kind: "followUp", text: `Plan the next one: ${p.title}`, atMs: ms(p.startAt) + p.durationMin * MIN, href: `/plan?id=${encodeURIComponent(p.id)}` });
  }

  for (const r of i.reviews) {
    if (r.count <= 0 || nowMs - r.atMs > REVIEW_DAYS * DAY) continue;
    out.push({
      id: `review:${r.meetingId}:${r.count}`,
      kind: "review",
      text: `${plural(r.count, "action item", "action items")} to review: ${r.title}`,
      atMs: r.atMs,
      href: `/meeting?id=${encodeURIComponent(r.meetingId)}&tab=actions`,
    });
  }
  return out;
}

/* ---------- read state ---------- */

export type ReadMap = Record<string, number>;

/** Parses the stored read map. Anything unreadable is "nothing read". */
export function parseRead(raw: string | null): ReadMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: ReadMap = {};
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (typeof t === "number" && Number.isFinite(t)) out[k] = t;
    return out;
  } catch {
    return {};
  }
}

export const unreadItems = (items: NotifItem[], read: ReadMap): NotifItem[] => items.filter((x) => !(x.id in read));
export const unreadCount = (items: NotifItem[], read: ReadMap): number => unreadItems(items, read).length;

/** Marks ids read now, drops entries older than two weeks and keeps the map small. */
export function markRead(read: ReadMap, ids: string[], nowMs: number): ReadMap {
  const next: ReadMap = {};
  for (const [k, t] of Object.entries(read)) if (nowMs - t <= READ_KEEP_DAYS * DAY) next[k] = t;
  for (const id of ids) next[id] = nowMs;
  const keys = Object.keys(next);
  if (keys.length > READ_MAX) {
    keys.sort((a, b) => next[a] - next[b]);
    for (const k of keys.slice(0, keys.length - READ_MAX)) delete next[k];
  }
  return next;
}

/** The badge text: nothing for 0, the number up to 9, "9+" above. */
export const badgeLabel = (n: number): string => (n <= 0 ? "" : n > 9 ? "9+" : String(n));

export const readKey = (userId: string) => `minutely.notifRead.${userId}`;
