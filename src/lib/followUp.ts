import { NEW_TOPICS_LINE, agendaPoints, prettyDay, type AgendaItem } from "./followUpAgenda.ts";
import { MAX_AGENDA, nextOccurrence, type Cadence } from "./planning.ts";
import { wallClockOf } from "./scheduling.ts";

/**
 * Pure helpers for "Plan next meeting" (Phase 17): which date the next meeting gets, how unfinished tasks are
 * merged into its agenda without repeating lines, and how many tasks an agenda carries. No database or React
 * imports, so node:test can load this file. The carried tasks are recorded in the agenda text only (no schema).
 */

export const CARRIED_PREFIX = "Carried over from ";
export const NO_CARRIED_LINE = "No unfinished tasks to carry over.";

const p2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in a time zone. */
export function dayInZone(iso: string | number | Date, tz: string): string {
  const w = wallClockOf(new Date(iso).getTime(), tz);
  return `${w.y}-${p2(w.m)}-${p2(w.d)}`;
}

/** "Carried over from Weekly sync (24 Nov 2026)". One line, no newlines. */
export function carriedHeading(title: string, day: string): string {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 120) || "the last meeting";
  return `${CARRIED_PREFIX}${t} (${/^\d{4}-\d{2}-\d{2}$/.test(day) ? prettyDay(day) : day})`;
}

/** The day printed in a heading ("24 Nov 2026") back to "YYYY-MM-DD", or null. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function parseHeading(line: string): { title: string; day: string } | null {
  const m = /^Carried over from (.+) \((\d{1,2}) ([A-Z][a-z]{2}) (\d{4})\)\s*$/.exec(line.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[3]);
  if (mo < 0) return null;
  return { title: m[1], day: `${m[4]}-${p2(mo + 1)}-${p2(Number(m[2]))}` };
}

/** Lowercase, numbering and bullets removed, whitespace collapsed: the key used to spot a repeated line. */
export function lineKey(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const NUMBERED = /^\s*\d+[.)]\s+/;

/** Added when some carried points don't fit within the agenda size limit. */
function omittedNote(n: number): string {
  return `(${n} more unfinished ${n === 1 ? "task" : "tasks"} not shown. See Meetings > Action items.)`;
}

export interface MergeResult {
  agenda: string;
  /** Points that were new to the agenda. */
  added: number;
}

/**
 * Put the carried points into an agenda.
 * - Empty agenda: heading, numbered points, then "Any new discussion topics".
 * - Existing agenda: the points are appended under the heading, skipping any line already there (ignoring
 *   numbering and case). Running it again changes nothing. The agenda is never cut: points that don't fit
 *   within `max` characters are left out and a short note says how many.
 */
export function mergeCarryOver(existing: string | null | undefined, points: string[], heading: string, max = MAX_AGENDA): MergeResult {
  const have = (existing ?? "").replace(/\r\n/g, "\n").trim();
  const seen = new Set(have.split("\n").map(lineKey).filter(Boolean));
  const fresh: string[] = [];
  for (const p of points.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    const k = lineKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(p);
  }

  if (!have) {
    const build = (list: string[]) => {
      const lines = [heading, ""];
      if (list.length === 0) lines.push(NO_CARRIED_LINE, "");
      [...list, NEW_TOPICS_LINE].forEach((p, n) => lines.push(`${n + 1}. ${p}`));
      if (list.length < fresh.length) lines.push("", omittedNote(fresh.length - list.length));
      return lines.join("\n");
    };
    let list = fresh;
    while (list.length && build(list).length > max) list = list.slice(0, -1);
    return { agenda: build(list), added: list.length };
  }

  if (fresh.length === 0) return { agenda: have, added: 0 };
  const headingPresent = have.split("\n").some((l) => lineKey(l) === lineKey(heading));
  let start = 1;
  if (headingPresent) {
    for (const l of have.split("\n")) {
      const n = /^\s*(\d+)[.)]\s/.exec(l);
      if (n) start = Math.max(start, Number(n[1]) + 1);
    }
  }
  const build = (list: string[]) =>
    `${have}\n\n${headingPresent ? "" : `${heading}\n`}${list.map((p, n) => `${start + n}. ${p}`).join("\n")}${list.length < fresh.length ? `
${omittedNote(fresh.length - list.length)}` : ""}`;
  let list = fresh;
  while (list.length && build(list).length > max) list = list.slice(0, -1);
  if (!list.length) return { agenda: have, added: 0 };
  return { agenda: build(list), added: list.length };
}

/** The unfinished tasks as agenda points in tracker order, ready for mergeCarryOver. */
export function carryPoints(items: AgendaItem[], today: string): string[] {
  return agendaPoints(items, today);
}

/** How many tasks an agenda says it carried over: the numbered lines under "Carried over from ..." headings. */
export function carriedCount(agenda: string | null | undefined): number {
  const lines = (agenda ?? "").replace(/\r\n/g, "\n").split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith(CARRIED_PREFIX)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (!NUMBERED.test(l)) break;
      if (lineKey(l) !== lineKey(NEW_TOPICS_LINE)) n++;
    }
  }
  return n;
}

/** "3 tasks carried over", "1 task carried over". */
export function carriedLabel(n: number): string {
  return `${n} ${n === 1 ? "task" : "tasks"} carried over`;
}

/* ---------- Date choice ---------- */

export interface NextStartInput {
  /** Start of the meeting being followed up (ms). */
  sourceStartMs: number;
  /** Start of the latest live meeting of its series, or the source itself without a series (ms). */
  latestStartMs: number;
  /** null: not in a series (one week later). */
  cadence: Cadence | null;
  timeZone: string;
  nowMs: number;
  /** Starts of live, still-planned meetings of the series (ms). Empty without a series. */
  plannedStartsMs: number[];
}

/**
 * The start of the next meeting. In a series, a planned meeting that already exists after the source and after
 * now (auto-planned ahead) is reused; otherwise the next date by cadence after the latest one. Without a series:
 * the same weekday and wall time one week later, moved on by whole weeks until it is in the future.
 */
export function chooseNextStart(i: NextStartInput): { startMs: number; reuse: boolean } | null {
  const floor = Math.max(i.nowMs, i.sourceStartMs);
  if (i.cadence) {
    const existing = i.plannedStartsMs.filter((t) => t > floor).sort((a, b) => a - b)[0];
    if (existing !== undefined) return { startMs: existing, reuse: true };
    const t = nextOccurrence(Math.max(i.latestStartMs, i.sourceStartMs), i.cadence, i.timeZone, floor);
    return t === null ? null : { startMs: t, reuse: false };
  }
  const t = nextOccurrence(i.sourceStartMs, "WEEKLY", i.timeZone, floor);
  return t === null ? null : { startMs: t, reuse: false };
}

/** The meeting that came before `currentStartMs` in a series: the latest one with a recording. */
export function previousRecorded<T extends { startAt: string | Date; meetingId: string | null }>(plans: T[], currentStartMs: number): T | null {
  let best: T | null = null;
  let bestT = -Infinity;
  for (const p of plans) {
    const t = new Date(p.startAt).getTime();
    if (!p.meetingId || t >= currentStartMs) continue;
    if (t > bestT) {
      best = p;
      bestT = t;
    }
  }
  return best;
}
