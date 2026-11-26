/** Deadline rules, shared by the screens and the API routes. Dates are "YYYY-MM-DD" in local time. */
export const MAX_DEADLINE_YEARS = 5;

export const DEADLINE_PAST = "Pick today or a later date.";
export const DEADLINE_FAR = "Pick a date within the next 5 years.";
export const DEADLINE_BAD = "Pick a valid date.";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date as YYYY-MM-DD in the device's local time. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parse(d: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return { y, m: mo, d: da };
}

/** The latest allowed date: the same calendar day, 5 years ahead. */
export function maxDeadline(now: Date = new Date()): string {
  return `${now.getFullYear() + MAX_DEADLINE_YEARS}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Returns an error message, or null when fine. An empty value is fine (no deadline).
 * `previous` is the date already stored: an unchanged value is kept even if it is now in the past.
 */
export function validateDeadline(value: string | null | undefined, opts: { previous?: string | null; now?: Date } = {}): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const day = v.slice(0, 10);
  if (opts.previous && opts.previous.slice(0, 10) === day) return null;
  if (!parse(day)) return DEADLINE_BAD;
  const now = opts.now ?? new Date();
  if (day < localToday(now)) return DEADLINE_PAST;
  if (day > maxDeadline(now)) return DEADLINE_FAR;
  return null;
}

/** Server clock for checks: the earliest "today" anywhere (UTC-12), so a user ahead of the server is never wrongly refused. */
export function lenientServerNow(): Date {
  return new Date(Date.now() - 12 * 3_600_000);
}
