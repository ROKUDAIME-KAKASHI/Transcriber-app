/**
 * Pure helpers for the simplified Schedule screen: handle suggestion, "days + one time range" <->
 * weekly availability, and meeting-length chips <-> event types. Relative imports only so node:test
 * can load it.
 */
import { DURATIONS, RESERVED_HANDLES, validateHandle, type AvailabilityRange } from "./scheduling.ts";

/** Monday first. Numbers follow JavaScript: 0 = Sunday. */
export const WEEK = [
  { n: 1, short: "Mon", label: "Monday" }, { n: 2, short: "Tue", label: "Tuesday" }, { n: 3, short: "Wed", label: "Wednesday" },
  { n: 4, short: "Thu", label: "Thursday" }, { n: 5, short: "Fri", label: "Friday" }, { n: 6, short: "Sat", label: "Saturday" },
  { n: 0, short: "Sun", label: "Sunday" },
] as const;

export const DEFAULT_START = 10 * 60;
export const DEFAULT_END = 17 * 60;
export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/* ---------- Handle ---------- */

/** A valid handle from the email's local part, or "" when nothing usable can be made. */
export function suggestHandle(email: string | null | undefined): string {
  let base = (email ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
  if (base.length > 0 && base.length < 3) base = `${base}${"meet".slice(0, 3 - base.length + 1)}`.slice(0, 30);
  if (base.length < 3) return "";
  if (RESERVED_HANDLES.includes(base)) base = `${base}-1`.slice(0, 30);
  return validateHandle(base).ok ? base : "";
}

/** `base` plus a numeric suffix, still within 30 characters. `attempt` 0 is a short number, higher is longer. */
export function handleWithDigits(base: string, attempt: number, rand: () => number = Math.random): string {
  const len = Math.min(2 + attempt, 6);
  let digits = "";
  for (let i = 0; i < len; i++) digits += Math.floor(rand() * 10);
  const root = (base || "meet").replace(/-+$/g, "").slice(0, 30 - digits.length).replace(/-+$/g, "");
  return `${root}${digits}`;
}

/* ---------- Hours ---------- */

export interface SimpleHours {
  days: number[];
  startMin: number;
  endMin: number;
}

/**
 * Express saved availability as "these days, one range". Returns null when days have different ranges
 * or more than one range per day (custom hours). No availability at all gives no days and the default range.
 */
export function simpleHoursFromAvailability(av: AvailabilityRange[]): SimpleHours | null {
  if (av.length === 0) return { days: [], startMin: DEFAULT_START, endMin: DEFAULT_END };
  const days = new Set<number>();
  for (const r of av) {
    if (days.has(r.weekday)) return null; // two ranges on one day
    days.add(r.weekday);
  }
  const { startMin, endMin } = av[0];
  if (av.some((r) => r.startMin !== startMin || r.endMin !== endMin)) return null;
  return { days: WEEK.map((w) => w.n).filter((n) => days.has(n)), startMin, endMin };
}

export function availabilityFromSimple(h: SimpleHours): AvailabilityRange[] {
  return WEEK.map((w) => w.n)
    .filter((n) => h.days.includes(n))
    .map((weekday) => ({ weekday, startMin: h.startMin, endMin: h.endMin }));
}

/* ---------- Meeting lengths ---------- */

export interface EventLike {
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

export interface MoreOptions {
  bufferMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
}

export const DEFAULT_OPTIONS: MoreOptions = { bufferMin: 0, minNoticeMin: 120, maxDaysAhead: 30 };

/** Chips that are on: any active, saved event of that length. A fresh (unsaved) default counts as 30. */
export function lengthsFromEvents(events: EventLike[]): number[] {
  return DURATIONS.filter((d) => events.some((e) => e.durationMin === d && e.active));
}

export function optionsFromEvents(events: EventLike[]): MoreOptions {
  const e = events.find((x) => x.active) ?? events[0];
  return e ? { bufferMin: e.bufferMin, minNoticeMin: e.minNoticeMin, maxDaysAhead: e.maxDaysAhead } : DEFAULT_OPTIONS;
}

/**
 * One event type per chosen length. An existing event of the same length is reused (slug "Nmin" preferred);
 * everything unselected, and any extra event that no chip owns, is switched off, never removed.
 */
export function applyLengths(existing: EventLike[], selected: number[], opts: MoreOptions): EventLike[] {
  const used = new Set<EventLike>();
  const out: EventLike[] = [];
  for (const d of DURATIONS) {
    const match = existing.find((e) => e.slug === `${d}min`) ?? existing.find((e) => e.durationMin === d && !used.has(e));
    const on = selected.includes(d);
    if (match) {
      used.add(match);
      out.push({ ...match, durationMin: d, active: on, ...opts });
    } else if (on) {
      out.push({ id: null, slug: `${d}min`, title: `${d} min meeting`, durationMin: d, active: true, description: null, ...opts });
    }
  }
  for (const e of existing) if (!used.has(e)) out.push({ ...e, active: false });
  return out.slice(0, 10);
}
