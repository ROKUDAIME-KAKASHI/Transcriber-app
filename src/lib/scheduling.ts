/**
 * Pure scheduling helpers: slot generation in the host's time zone, handle validation and calendar
 * links. No imports, so node:test can load this file and it runs on server and client.
 */

export const HANDLE_RE = /^[a-z0-9-]{3,30}$/;
export const EVENT_SLUG_RE = /^[a-z0-9-]{2,30}$/;
export const DURATIONS = [15, 30, 45, 60] as const;
export const MAX_RANGE_DAYS = 45;

/** Words that would collide with routes or look official. */
export const RESERVED_HANDLES = [
  "api", "book", "schedule", "admin", "login", "logout", "register", "app", "ics", "cancel", "confirmed",
  "www", "settings", "meeting", "meetings", "tasks", "offline", "transcriber", "support", "help", "about",
  "new", "null", "undefined", "me", "user", "users", "dashboard", "downloads", "static", "health", "root",
];

export function validateHandle(raw: string): { ok: true; handle: string } | { ok: false; error: string } {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: "Use 3 to 30 letters, numbers or hyphens." };
  }
  if (handle.startsWith("-") || handle.endsWith("-")) {
    return { ok: false, error: "A handle can't start or end with a hyphen." };
  }
  if (RESERVED_HANDLES.includes(handle)) return { ok: false, error: "That handle is reserved. Pick another." };
  return { ok: true, handle };
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface AvailabilityRange {
  weekday: number;
  startMin: number;
  endMin: number;
}

export const DEFAULT_AVAILABILITY: AvailabilityRange[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMin: 10 * 60,
  endMin: 17 * 60,
}));

/** Sort, drop invalid ranges and merge overlaps per weekday. Returns null when nothing valid remains and `strict` input was bad. */
export function normalizeAvailability(input: AvailabilityRange[]): AvailabilityRange[] {
  const out: AvailabilityRange[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const ranges = input
      .filter((r) => r.weekday === wd)
      .sort((a, b) => a.startMin - b.startMin);
    let cur: AvailabilityRange | null = null;
    for (const r of ranges) {
      if (cur && r.startMin <= cur.endMin) cur.endMin = Math.max(cur.endMin, r.endMin);
      else {
        cur = { weekday: wd, startMin: r.startMin, endMin: r.endMin };
        out.push(cur);
      }
    }
  }
  return out;
}

export function isValidRange(r: AvailabilityRange): boolean {
  return (
    Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 &&
    Number.isInteger(r.startMin) && Number.isInteger(r.endMin) &&
    r.startMin >= 0 && r.endMin <= 1440 && r.startMin < r.endMin
  );
}

/* ---------- Time zone conversion (Intl only) ---------- */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface WallClock {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
}

export function wallClockOf(utcMs: number, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Some engines render midnight as hour 24.
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

/** Offset (local minus UTC) in ms for a UTC instant. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const w = wallClockOf(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, 0);
  return asUtc - Math.floor(utcMs / 60000) * 60000;
}

/**
 * The UTC instant for a wall-clock time in `tz`. Returns null for times that don't exist (the hour
 * skipped by a spring-forward). For a repeated time (fall-back) the earlier instant wins.
 */
export function zonedToUtc(w: WallClock, tz: string): number | null {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, 0);
  // The offsets in force a day before and after bracket any transition near this wall time.
  const offsets = new Set([tzOffsetMs(guess - 86_400_000, tz), tzOffsetMs(guess + 86_400_000, tz)]);
  const valid: number[] = [];
  for (const off of offsets) {
    const t = guess - off;
    const b = wallClockOf(t, tz);
    if (b.y === w.y && b.m === w.m && b.d === w.d && b.h === w.h && b.min === w.min) valid.push(t);
  }
  return valid.length ? Math.min(...valid) : null;
}

/* ---------- Slot generation ---------- */

export interface SlotParams {
  availability: AvailabilityRange[];
  timeZone: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  /** CONFIRMED bookings only. */
  bookings: { startAt: Date | string; endAt: Date | string }[];
  /** Window: from (inclusive) to (exclusive), UTC instants. */
  from: Date;
  to: Date;
  now: Date;
}

const MIN = 60_000;
const DAY = 86_400_000;

/** Start times (ISO, UTC) a guest can book. */
export function generateSlots(p: SlotParams): string[] {
  const dur = p.durationMin * MIN;
  const buf = p.bufferMin * MIN;
  const earliest = Math.max(p.from.getTime(), p.now.getTime() + p.minNoticeMin * MIN);
  const latest = Math.min(p.to.getTime(), p.now.getTime() + p.maxDaysAhead * DAY);
  if (!(earliest < latest) || p.durationMin <= 0) return [];

  const busy = p.bookings.map((b) => [new Date(b.startAt).getTime(), new Date(b.endAt).getTime()] as const);
  const byWeekday = new Map<number, AvailabilityRange[]>();
  for (const r of p.availability) {
    if (!isValidRange(r)) continue;
    const list = byWeekday.get(r.weekday) ?? [];
    list.push(r);
    byWeekday.set(r.weekday, list);
  }

  // Walk host-local calendar days, one day either side of the window to cover offset differences.
  const first = wallClockOf(earliest - DAY, p.timeZone);
  const last = wallClockOf(latest + DAY, p.timeZone);
  const endDay = Date.UTC(last.y, last.m - 1, last.d);
  const seen = new Set<number>();
  const out: number[] = [];

  for (let day = Date.UTC(first.y, first.m - 1, first.d); day <= endDay; day += DAY) {
    const dt = new Date(day);
    const ranges = byWeekday.get(dt.getUTCDay());
    if (!ranges) continue;
    for (const r of ranges) {
      for (let s = r.startMin; s + p.durationMin <= r.endMin; s += p.durationMin) {
        const start = zonedToUtc(
          { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: Math.floor(s / 60), min: s % 60 },
          p.timeZone
        );
        if (start === null || seen.has(start)) continue;
        if (start < earliest || start >= latest) continue;
        const end = start + dur;
        if (busy.some(([bs, be]) => start < be + buf && end + buf > bs)) continue;
        seen.add(start);
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a - b).map((t) => new Date(t).toISOString());
}

/** True when `start` is exactly one of the currently bookable slots. */
export function isSlotAvailable(start: Date, p: Omit<SlotParams, "from" | "to">): boolean {
  const slots = generateSlots({ ...p, from: start, to: new Date(start.getTime() + MIN) });
  return slots.length === 1 && slots[0] === start.toISOString();
}

/* ---------- Calendar files and links ---------- */

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** A CN parameter value: control characters and quotes removed, double-quoted so ':' ';' ',' are safe. */
function icsParam(s: string): string {
  return `"${s.replace(/[\u0000-\u001f\u007f"]/g, " ").trim()}"`;
}

/** Fold a content line to 75 octets (counting UTF-8 bytes, never splitting a character). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chunks: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      chunks.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += n;
  }
  chunks.push(cur);
  return chunks.join("\r\n ");
}

export interface IcsInput {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description?: string | null;
  organizerName: string;
  /** Used for ORGANIZER; calendars need a mailto value. */
  organizerEmail: string;
  attendeeName?: string;
  attendeeEmail?: string;
  /** More guests (planned meetings). Each needs an address; callers drop people without one. */
  attendees?: { name: string; email: string }[];
  location?: string | null;
  url?: string;
  now?: Date;
  cancelled?: boolean;
  /** Calendar invite semantics. Omitted: METHOD:PUBLISH exactly as before. */
  method?: "PUBLISH" | "REQUEST" | "CANCEL";
  /** iCalendar SEQUENCE; omitted: no SEQUENCE line. */
  sequence?: number;
  /** Ask `attendees` to reply (RSVP=TRUE, PARTSTAT=NEEDS-ACTION). */
  rsvp?: boolean;
}

export function buildIcs(i: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Minutely//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method ?? "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `DTSTAMP:${icsStamp(i.now ?? new Date())}`,
    `DTSTART:${icsStamp(i.start)}`,
    `DTEND:${icsStamp(i.end)}`,
    `SUMMARY:${icsEscape(i.title)}`,
  ];
  if (i.sequence !== undefined) lines.push(`SEQUENCE:${Math.max(0, Math.floor(i.sequence))}`);
  if (i.description) lines.push(`DESCRIPTION:${icsEscape(i.description)}`);
  if (i.location) lines.push(`LOCATION:${icsEscape(i.location)}`);
  if (i.url) lines.push(`URL:${i.url}`);
  lines.push(
    `ORGANIZER;CN=${icsParam(i.organizerName)}:mailto:${i.organizerEmail}`,
    ...(i.attendeeName && i.attendeeEmail ? [`ATTENDEE;CN=${icsParam(i.attendeeName)};ROLE=REQ-PARTICIPANT:mailto:${i.attendeeEmail}`] : []),
    ...(i.attendees ?? []).map((a) => `ATTENDEE;CN=${icsParam(a.name)};ROLE=REQ-PARTICIPANT${i.rsvp ? ";PARTSTAT=NEEDS-ACTION;RSVP=TRUE" : ""}:mailto:${a.email.replace(/[^\x21-\x7e]|[<>"]/g, "")}`),
    `STATUS:${i.cancelled || i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(i: { title: string; start: Date; end: Date; details?: string | null }): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: i.title,
    dates: `${icsStamp(i.start)}/${icsStamp(i.end)}`,
  });
  if (i.details) q.set("details", i.details);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** "Fri, 28 Nov, 3:30 pm" in `tz`, fixed en-IN-ish format independent of the device locale. */
export function formatInZone(iso: string | Date, tz: string, withDate = true): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const opts: Intl.DateTimeFormatOptions = withDate
    ? { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }
    : { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true };
  return new Intl.DateTimeFormat("en-GB", opts).format(d).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase());
}

/** YYYY-MM-DD of an instant in `tz`. */
export function dayKey(iso: string | Date, tz: string): string {
  const w = wallClockOf(typeof iso === "string" ? new Date(iso).getTime() : iso.getTime(), tz);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}
