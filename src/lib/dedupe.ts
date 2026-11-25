/** Pure duplicate-detection helpers. No imports, so node:test can load them. They only tag; nothing is ever deleted. */

export const NEAR_DUPLICATE = 0.8;

const ARTICLES = new Set(["a", "an", "the"]);

/** Lowercase, drop punctuation and articles, collapse whitespace. Keeps letters and marks of any script. */
export function normalizeTaskText(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}

/** Token Jaccard similarity of two task texts, 0 to 1. Empty text never matches anything. */
export function similarity(a: string, b: string): number {
  const x = new Set(normalizeTaskText(a).split(" ").filter(Boolean));
  const y = new Set(normalizeTaskText(b).split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

export type MatchKind = "same" | "near";

/** How a task compares with a list of existing task texts: an exact normalized match, a near match, or none. */
export function matchTask(task: string, existing: readonly string[]): { kind: MatchKind; index: number } | null {
  const n = normalizeTaskText(task);
  if (!n) return null;
  let near = -1;
  let best = 0;
  for (let i = 0; i < existing.length; i++) {
    if (normalizeTaskText(existing[i]) === n) return { kind: "same", index: i };
    const s = similarity(task, existing[i]);
    if (s >= NEAR_DUPLICATE && s > best) {
      best = s;
      near = i;
    }
  }
  return near >= 0 ? { kind: "near", index: near } : null;
}

/** For each task, the id of another task in the same meeting that looks like a duplicate (similarity at least 0.8). */
export function findTaskDuplicates<T extends { id: string; task: string; meeting: { id: string } }>(
  items: readonly T[]
): Map<string, string> {
  const byMeeting = new Map<string, T[]>();
  for (const t of items) {
    const list = byMeeting.get(t.meeting.id);
    if (list) list.push(t);
    else byMeeting.set(t.meeting.id, [t]);
  }
  const out = new Map<string, string>();
  for (const list of byMeeting.values()) {
    for (let i = 0; i < list.length; i++) {
      let best = 0;
      let other = "";
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const s = similarity(list[i].task, list[j].task);
        if (s >= NEAR_DUPLICATE && s > best) {
          best = s;
          other = list[j].id;
        }
      }
      if (other) out.set(list[i].id, other);
    }
  }
  return out;
}

/* ---------- meetings ---------- */

export interface MeetingLike {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number;
}

export const MEETING_DUP_WINDOW_MS = 10 * 60 * 1000;
export const MEETING_DUP_DURATION = 0.2;

export function isDuplicateMeeting(a: MeetingLike, b: MeetingLike): boolean {
  const ta = normalizeTaskText(a.title);
  if (!ta || ta !== normalizeTaskText(b.title)) return false;
  const sa = Date.parse(a.createdAt);
  const sb = Date.parse(b.createdAt);
  if (!Number.isFinite(sa) || !Number.isFinite(sb) || Math.abs(sa - sb) > MEETING_DUP_WINDOW_MS) return false;
  const hi = Math.max(a.durationSec, b.durationSec);
  return Math.abs(a.durationSec - b.durationSec) <= hi * MEETING_DUP_DURATION;
}

/** Ids of meetings that look like a duplicate of another one: same title, start within 10 minutes, length within 20%. */
export function findDuplicateMeetings(list: readonly MeetingLike[]): Set<string> {
  const out = new Set<string>();
  const sorted = [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const gap = Date.parse(sorted[j].createdAt) - Date.parse(sorted[i].createdAt);
      if (gap > MEETING_DUP_WINDOW_MS) break;
      if (isDuplicateMeeting(sorted[i], sorted[j])) {
        out.add(sorted[i].id);
        out.add(sorted[j].id);
      }
    }
  }
  return out;
}

/* ---------- bookings ---------- */

export interface BookingLike {
  id: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
}

function dayKey(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Ids of bookings where the same guest email has another booking that overlaps or falls on the same day (in the host's zone). */
export function findRepeatBookings(list: readonly BookingLike[], tz = "UTC"): Set<string> {
  const byGuest = new Map<string, BookingLike[]>();
  for (const b of list) {
    const key = b.guestEmail.trim().toLowerCase();
    if (!key) continue;
    const g = byGuest.get(key);
    if (g) g.push(b);
    else byGuest.set(key, [b]);
  }
  const out = new Set<string>();
  for (const g of byGuest.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i];
        const b = g[j];
        const overlap = Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
        if (overlap || dayKey(a.startAt, tz) === dayKey(b.startAt, tz)) {
          out.add(a.id);
          out.add(b.id);
        }
      }
    }
  }
  return out;
}

/** Drop items whose normalized task already exists (saved earlier, or earlier in the same list). Counts what was skipped. */
export function skipExactDuplicates<T extends { task: string }>(items: readonly T[], existing: readonly string[]): { fresh: T[]; skipped: number } {
  const seen = new Set(existing.map(normalizeTaskText));
  const fresh: T[] = [];
  let skipped = 0;
  for (const it of items) {
    const n = normalizeTaskText(it.task);
    if (n && seen.has(n)) {
      skipped++;
      continue;
    }
    if (n) seen.add(n);
    fresh.push(it);
  }
  return { fresh, skipped };
}
