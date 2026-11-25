import { formatInZone, isValidRange, wallClockOf, zonedToUtc, type AvailabilityRange } from "./scheduling.ts";
import { occurrenceAt, type Cadence } from "./planning.ts";

/**
 * Pure calendar helpers: interval maths, common free slots (time zone and DST aware), conflict messages,
 * the series "keep N ahead" planner and invite wording. No database, no React: node:test loads this file.
 */

const MIN = 60_000;
const DAY = 86_400_000;

export const KEEP_AHEAD_CHOICES = [0, 2, 4, 8] as const;
export const MAX_KEEP_AHEAD = 8;
export const MAX_FREEBUSY_EMAILS = 10;
export const MAX_FREEBUSY_DAYS = 14;
export const MAX_INVITE_RECIPIENTS = 30;
export const SUGGEST_DAYS = 14;
export const MAX_SUGGESTIONS = 6;

/* ---------- Intervals ---------- */

export interface Interval {
  start: number;
  end: number;
}

/** Sort and merge touching or overlapping intervals; drops empty or reversed ones. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/* ---------- Working hours ---------- */

export interface WorkingHours {
  timeZone: string;
  ranges: AvailabilityRange[];
}

/** A person's weekly ranges as UTC intervals between `fromMs` and `toMs`. DST safe: both ends go through the zone. */
export function workingIntervals(w: WorkingHours, fromMs: number, toMs: number): Interval[] {
  const byDay = new Map<number, AvailabilityRange[]>();
  for (const r of w.ranges) {
    if (!isValidRange(r)) continue;
    const l = byDay.get(r.weekday) ?? [];
    l.push(r);
    byDay.set(r.weekday, l);
  }
  const first = wallClockOf(fromMs - DAY, w.timeZone);
  const last = wallClockOf(toMs + DAY, w.timeZone);
  const endDay = Date.UTC(last.y, last.m - 1, last.d);
  const out: Interval[] = [];
  const at = (dayMs: number, minutes: number): number | null => {
    const t = new Date(dayMs + Math.floor(minutes / 1440) * DAY);
    const m = minutes % 1440;
    const wc = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: Math.floor(m / 60), min: m % 60 };
    // A wall time skipped by a spring-forward: use the hour after it.
    return zonedToUtc(wc, w.timeZone) ?? zonedToUtc({ ...wc, h: wc.h + 1 }, w.timeZone);
  };
  for (let day = Date.UTC(first.y, first.m - 1, first.d); day <= endDay; day += DAY) {
    const ranges = byDay.get(new Date(day).getUTCDay());
    if (!ranges) continue;
    for (const r of ranges) {
      const s = at(day, r.startMin);
      const e = at(day, r.endMin);
      if (s !== null && e !== null && e > s && e > fromMs && s < toMs) out.push({ start: s, end: e });
    }
  }
  return mergeIntervals(out);
}

/* ---------- Common free slots ---------- */

export interface PersonAvailability {
  /** Stable key (an email, or "me"). */
  key: string;
  busy: Interval[];
  /** Null means "use the fallback hours" (a person who shares busy time but has no hours saved). */
  working: WorkingHours | null;
}

export interface CommonSlotParams {
  /** Only people whose availability is known. */
  people: PersonAvailability[];
  fallbackWorking: WorkingHours;
  durationMin: number;
  fromMs: number;
  toMs: number;
  /** Day grouping for the "at most two per day" spread. */
  displayTz: string;
  stepMin?: number;
  max?: number;
  perDay?: number;
}

export interface CommonSlot {
  startMs: number;
  endMs: number;
}

function insideSome(list: Interval[], s: number, e: number): boolean {
  return list.some((i) => i.start <= s && e <= i.end);
}

/**
 * Up to `max` start times (on `stepMin` boundaries of the UTC clock, which lines up with every real
 * time zone offset) where everyone in `people` is inside their working hours and not busy for the
 * whole length. Prefers the earliest, spread over days (two a day first, then fill).
 */
export function findCommonSlots(p: CommonSlotParams): CommonSlot[] {
  const step = (p.stepMin ?? 15) * MIN;
  const dur = p.durationMin * MIN;
  const max = p.max ?? MAX_SUGGESTIONS;
  const perDay = p.perDay ?? 2;
  if (!(dur > 0) || !(p.fromMs < p.toMs) || p.people.length === 0) return [];
  const prepared = p.people.map((x) => ({
    busy: mergeIntervals(x.busy),
    working: workingIntervals(x.working ?? p.fallbackWorking, p.fromMs, p.toMs + dur),
  }));
  const all: CommonSlot[] = [];
  for (let t = Math.ceil(p.fromMs / step) * step; t + dur <= p.toMs; t += step) {
    const e = t + dur;
    const ok = prepared.every((x) => insideSome(x.working, t, e) && !x.busy.some((b) => overlaps(b, { start: t, end: e })));
    if (ok) all.push({ startMs: t, endMs: e });
    if (all.length > 2000) break;
  }
  const chosen: CommonSlot[] = [];
  const dayOf = (s: CommonSlot) => wallClockOf(s.startMs, p.displayTz);
  const key = (s: CommonSlot) => {
    const w = dayOf(s);
    return `${w.y}-${w.m}-${w.d}`;
  };
  const clash = (s: CommonSlot) => chosen.some((c) => overlaps({ start: c.startMs, end: c.endMs }, { start: s.startMs, end: s.endMs }));
  for (const cap of [perDay, max]) {
    for (const s of all) {
      if (chosen.length >= max) break;
      if (chosen.includes(s) || clash(s)) continue;
      if (chosen.filter((c) => key(c) === key(s)).length >= cap) continue;
      chosen.push(s);
    }
  }
  return chosen.sort((a, b) => a.startMs - b.startMs);
}

/** The date (YYYY-MM-DD) and time (HH:mm) of an instant in `tz`, as the plan form wants them. */
export function formFieldsAt(ms: number, tz: string): { date: string; time: string } {
  const w = wallClockOf(ms, tz);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { date: `${w.y}-${p2(w.m)}-${p2(w.d)}`, time: `${p2(w.h)}:${p2(w.min)}` };
}

/* ---------- Conflicts ---------- */

export interface BusyBlock {
  startMs: number;
  endMs: number;
  title: string;
}

/** Existing items that overlap [startMs, endMs). Soonest first. */
export function conflictsWith(blocks: BusyBlock[], startMs: number, endMs: number): BusyBlock[] {
  return blocks.filter((b) => b.startMs < endMs && startMs < b.endMs).sort((a, b) => a.startMs - b.startMs);
}

/** "You already have Weekly review at 3:00 pm" (several: "... and 1 more"). */
export function conflictMessage(blocks: BusyBlock[], tz: string): string | null {
  if (blocks.length === 0) return null;
  const one = (b: BusyBlock) => `${b.title.replace(/\s+/g, " ").trim().slice(0, 60) || "a meeting"} at ${formatInZone(new Date(b.startMs), tz, false)}`;
  const first = `You already have ${one(blocks[0])}`;
  return blocks.length > 1 ? `${first} and ${blocks.length - 1} more` : first;
}

/* ---------- Free/busy request validation ---------- */

/** Lower-cased, de-duplicated, syntactically valid emails (up to `max`). Returns null when more than `max` valid ones were sent. */
export function parseEmailList(raw: string | null, max = MAX_FREEBUSY_EMAILS): string[] | null {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase();
    if (!e || e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    seen.add(e);
  }
  return seen.size > max ? null : [...seen];
}

export function validRange(from: Date, to: Date, maxDays = MAX_FREEBUSY_DAYS): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return "Invalid date range.";
  if (to.getTime() - from.getTime() > maxDays * DAY) return `Ask for at most ${maxDays} days at a time.`;
  return null;
}

/* ---------- Series: keep N ahead ---------- */

/**
 * Start times (ms) of occurrences to create so that `keepAhead` future planned meetings exist.
 * Occurrences come from the latest meeting by the cadence (never chained). Any start already in
 * `takenMs` (planned, cancelled or deleted) is skipped, so a cancelled single occurrence stays cancelled
 * and the series simply reaches one further.
 */
export function missingOccurrences(p: {
  baseMs: number;
  cadence: Cadence;
  timeZone: string;
  nowMs: number;
  takenMs: number[];
  futurePlanned: number;
  keepAhead: number;
}): number[] {
  if (p.cadence === "NONE") return [];
  const want = Math.min(Math.max(0, Math.floor(p.keepAhead)), MAX_KEEP_AHEAD) - p.futurePlanned;
  if (want <= 0) return [];
  const taken = new Set(p.takenMs);
  const out: number[] = [];
  for (let k = 1; k <= 200 && out.length < want; k++) {
    const t = occurrenceAt(p.baseMs, p.cadence, p.timeZone, k);
    if (t === null) break;
    if (t <= p.nowMs || taken.has(t)) continue;
    out.push(t);
  }
  return out;
}

/* ---------- Invites ---------- */

export type IcsMethod = "PUBLISH" | "REQUEST" | "CANCEL";

/** REQUEST and CANCEL name attendees, so with nobody to name the file stays a plain PUBLISH. */
export function icsMethodFor(status: string, attendeeCount: number): IcsMethod {
  if (attendeeCount === 0) return "PUBLISH";
  return status === "CANCELLED" ? "CANCEL" : "REQUEST";
}

/** True when a change should reach invitees as an update: time, length, place, link or title. */
export function needsSequenceBump(
  before: { title: string; startAt: Date; durationMin: number; venue: string | null; callUrl: string | null; status: string },
  after: { title?: string; startAt?: Date; durationMin?: number; venue?: string | null; callUrl?: string | null; status?: string }
): boolean {
  if (after.title !== undefined && after.title !== before.title) return true;
  if (after.startAt !== undefined && after.startAt.getTime() !== before.startAt.getTime()) return true;
  if (after.durationMin !== undefined && after.durationMin !== before.durationMin) return true;
  if (after.venue !== undefined && (after.venue ?? null) !== before.venue) return true;
  if (after.callUrl !== undefined && (after.callUrl ?? null) !== before.callUrl) return true;
  if (after.status !== undefined && after.status !== before.status) return true;
  return false;
}

export function inviteSubject(title: string, startAt: Date | string, tz: string, kind: "invite" | "update" | "cancel"): string {
  const t = title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Meeting";
  const when = formatInZone(startAt, tz);
  return `${kind === "invite" ? "Invitation" : kind === "update" ? "Updated invitation" : "Cancelled"}: ${t} · ${when}`;
}

export type InviteLabel = "Send invites" | "Send update" | "Send cancellation";

/** What the invite button says: by plan status and whether anyone was invited before. */
export function inviteLabel(status: string, anyInvited: boolean): InviteLabel | null {
  if (status === "CANCELLED") return anyInvited ? "Send cancellation" : null;
  if (status !== "PLANNED") return null;
  return anyInvited ? "Send update" : "Send invites";
}
