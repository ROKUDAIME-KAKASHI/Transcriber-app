import type { PlanDTO } from "./planning.ts";
import { replaceInWindow } from "./calendarView.ts";

/**
 * Fetchers for what the calendar and the notification panel show, plus a small per-user copy on this device so
 * both still have something to show offline. Every fetcher answers null on any failure (offline, paused, not
 * migrated): the caller then keeps the cached copy. The copy holds the latest ~300 planned meetings and bookings.
 */

export interface BookingDTO {
  id: string;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  startAt: string;
  endAt: string;
  agenda: string | null;
  meetingId: string | null;
  createdAt?: string;
  eventTitle: string;
}

export interface CalCache {
  tz: string | null;
  plans: PlanDTO[];
  bookings: BookingDTO[];
}

const key = (userId: string) => `minutely.calcache.${userId}`;
const EMPTY: CalCache = { tz: null, plans: [], bookings: [] };

export function readCalCache(userId: string | null): CalCache {
  if (!userId || typeof localStorage === "undefined") return EMPTY;
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) ?? "null") as Partial<CalCache> | null;
    if (!v || typeof v !== "object") return EMPTY;
    return {
      tz: typeof v.tz === "string" ? v.tz : null,
      plans: Array.isArray(v.plans) ? v.plans : [],
      bookings: Array.isArray(v.bookings) ? v.bookings : [],
    };
  } catch {
    return EMPTY;
  }
}

/** A window the fresh rows are the full answer for. */
interface Win {
  fromMs: number;
  toMs: number;
}

/** Folds a fresh answer into the copy and returns the result. Storage problems are ignored. */
export function writeCalCache(
  userId: string | null,
  patch: { tz?: string; plans?: { rows: PlanDTO[]; win: Win }; bookings?: { rows: BookingDTO[]; win: Win } }
): CalCache {
  const old = readCalCache(userId);
  const next: CalCache = {
    tz: patch.tz ?? old.tz,
    plans: patch.plans ? replaceInWindow(old.plans, patch.plans.rows, patch.plans.win.fromMs, patch.plans.win.toMs) : old.plans,
    bookings: patch.bookings ? replaceInWindow(old.bookings, patch.bookings.rows, patch.bookings.win.fromMs, patch.bookings.win.toMs) : old.bookings,
  };
  if (userId) {
    try {
      localStorage.setItem(key(userId), JSON.stringify(next));
    } catch {
      /* storage full or blocked: just no offline copy */
    }
  }
  return next;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Planned meetings that start between the two times. The server filters by range (up to 200 rows). */
export async function loadPlans(userId: string | null, fromMs: number, toMs: number, opts: { readOnly?: boolean } = {}): Promise<CalCache | null> {
  const q = new URLSearchParams({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
  if (opts.readOnly) q.set("ahead", "0");
  const j = await getJson<{ plans?: PlanDTO[] }>(`/api/plans?${q}`);
  if (!j || !Array.isArray(j.plans)) return null;
  return writeCalCache(userId, { plans: { rows: j.plans, win: { fromMs, toMs } } });
}

/** The host's upcoming confirmed bookings. The endpoint has no range filter (and no past bookings), so callers filter by date themselves. */
export async function loadBookings(userId: string | null): Promise<CalCache | null> {
  const j = await getJson<{ bookings?: BookingDTO[] }>("/api/schedule/bookings");
  if (!j || !Array.isArray(j.bookings)) return null;
  // The endpoint answers for everything that hasn't ended yet: that is the window it replaces.
  return writeCalCache(userId, { bookings: { rows: j.bookings, win: { fromMs: Date.now() - 86_400_000, toMs: Number.MAX_SAFE_INTEGER } } });
}

/** The user's saved time zone (null when none is saved or the request failed). */
export async function loadTimeZone(userId: string | null): Promise<string | null> {
  const j = await getJson<{ timeZone?: string | null }>("/api/schedule/settings");
  if (!j?.timeZone) return null;
  writeCalCache(userId, { tz: j.timeZone });
  return j.timeZone;
}

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
