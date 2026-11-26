import { dateGroup, type DateGroup } from "./dateGroup.ts";

export interface ListItem {
  title: string;
  createdAt: string;
  durationSec: number;
  /** Optional: only matched when the loaded list data carries it. */
  text?: string | null;
}

export interface ListStats {
  total: number;
  /** Hours recorded, or null when no durations are known. */
  hours: number | null;
  /** Meetings in the last 7 days (Today, Yesterday, This week), or null when there are none to count. */
  thisWeek: number | null;
}

export function listStats(items: ListItem[], now: Date): ListStats {
  const total = items.length;
  const sec = items.reduce((s, m) => s + (m.durationSec > 0 ? m.durationSec : 0), 0);
  const week = items.filter((m) => dateGroup(new Date(m.createdAt), now) !== "Earlier").length;
  return { total, hours: sec > 0 ? sec / 3600 : null, thisWeek: total > 0 ? week : null };
}

export function formatHours(h: number): string {
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
}

/** Case-insensitive match on title, and on transcript text when the row has it. */
export function filterMeetings<T extends ListItem>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((m) => m.title.toLowerCase().includes(q) || (m.text ?? "").toLowerCase().includes(q));
}

/** Consecutive-run grouping (input is newest first). Empty label when `now` is null. */
export function groupMeetings<T extends ListItem>(items: T[], now: Date | null): { label: DateGroup | ""; items: T[] }[] {
  if (!now) return [{ label: "", items }];
  const out: { label: DateGroup | ""; items: T[] }[] = [];
  for (const m of items) {
    const label = dateGroup(new Date(m.createdAt), now);
    const last = out[out.length - 1];
    if (last?.label === label) last.items.push(m);
    else out.push({ label, items: [m] });
  }
  return out;
}
