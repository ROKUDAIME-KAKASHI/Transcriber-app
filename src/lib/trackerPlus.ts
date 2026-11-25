import { OWNER_PERSON_PREFIX, STATUSES, compareTasks, dueDay, isOverdue, type TaskRow, type TaskStatus } from "./taskTracker.ts";

/**
 * Pure helpers for the tracker upgrades (Phase 16): timeline bucketing, series progress, owner linking and the
 * overdue reminder rules. No React or database imports, so node:test can load this file.
 * All "days" are calendar days as "YYYY-MM-DD". "Today" is the user's local day (see localToday in taskTracker).
 */

/* ---------- calendar day arithmetic (no time zones involved) ---------- */

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(ymd: string, n: number): string {
  const t = toUtc(ymd);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayMon0(ymd: string): number {
  return (toUtc(ymd).getUTCDay() + 6) % 7;
}

/* ---------- timeline ---------- */

export const TIMELINE_SECTIONS = ["overdue", "today", "thisWeek", "nextWeek", "later", "none", "done"] as const;
export type TimelineSection = (typeof TIMELINE_SECTIONS)[number];

export const TIMELINE_LABEL: Record<TimelineSection, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  nextWeek: "Next week",
  later: "Later",
  none: "No date",
  done: "Done",
};

type Bucketable = Pick<TaskRow, "dueDate" | "status">;

/**
 * Which section a task belongs to. Weeks run Monday to Sunday: "This week" is tomorrow up to this Sunday,
 * "Next week" is the following Monday to Sunday. Done tasks only ever land in "done".
 */
export function timelineSection(t: Bucketable, today: string): TimelineSection {
  if (t.status === "DONE") return "done";
  const d = dueDay(t.dueDate);
  if (!d) return "none";
  if (d < today) return "overdue";
  if (d === today) return "today";
  const weekEnd = addDays(today, 6 - weekdayMon0(today));
  if (d <= weekEnd) return "thisWeek";
  if (d <= addDays(weekEnd, 7)) return "nextWeek";
  return "later";
}

export interface TimelineGroup<T> {
  section: TimelineSection;
  label: string;
  items: T[];
}

/** Non-empty sections in display order, each sorted by due day then newest. Done tasks only with showDone. */
export function groupTimeline<T extends Bucketable & Pick<TaskRow, "createdAt">>(items: readonly T[], today: string, showDone: boolean): TimelineGroup<T>[] {
  const by = new Map<TimelineSection, T[]>();
  for (const t of items) {
    const s = timelineSection(t, today);
    if (s === "done" && !showDone) continue;
    const list = by.get(s);
    if (list) list.push(t);
    else by.set(s, [t]);
  }
  return TIMELINE_SECTIONS.flatMap((section) => {
    const list = by.get(section);
    if (!list?.length) return [];
    return [{ section, label: TIMELINE_LABEL[section], items: list.slice().sort(compareTasks) }];
  });
}

/* ---------- overdue summary and reminders ---------- */

export interface OverdueSummary {
  overdue: number;
  dueToday: number;
  open: number;
}

export function summarize(items: readonly Bucketable[], today: string): OverdueSummary {
  const out: OverdueSummary = { overdue: 0, dueToday: 0, open: 0 };
  for (const t of items) {
    if (t.status === "DONE") continue;
    out.open++;
    if (isOverdue(t, today)) out.overdue++;
    else if (dueDay(t.dueDate) === today) out.dueToday++;
  }
  return out;
}

export function parseSummary(x: unknown): OverdueSummary | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const overdue = n(o.overdue);
  const dueToday = n(o.dueToday);
  const open = n(o.open);
  return overdue === null || dueToday === null || open === null ? null : { overdue, dueToday, open };
}

/** "1 task is overdue" / "3 tasks are overdue". */
export function overdueText(n: number): string {
  return n === 1 ? "1 task is overdue" : `${n} tasks are overdue`;
}

/** The accessible name of the count badge on the Tasks tab. */
export function overdueBadgeLabel(n: number): string {
  return n === 1 ? "1 overdue task" : `${n} overdue tasks`;
}

export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** The once-a-day toast: only with reminders on, something overdue, and not already shown today. */
export function shouldToastOverdue(i: { enabled: boolean; overdue: number; lastShownDay: string | null; today: string }): boolean {
  return i.enabled && i.overdue > 0 && i.lastShownDay !== i.today;
}

/* ---------- series progress ---------- */

export interface ProgressTask {
  meetingId: string;
  status: string;
  dueDate: string | null;
}

export interface ProgressMeeting {
  meetingId: string;
  title: string;
  /** ISO timestamp of the meeting (planned start). */
  date: string;
}

export interface MeetingProgress extends ProgressMeeting {
  done: number;
  total: number;
}

export interface SeriesProgress {
  counts: Record<TaskStatus, number>;
  total: number;
  overdue: number;
  meetings: MeetingProgress[];
}

const asStatus = (s: string): TaskStatus => ((STATUSES as readonly string[]).includes(s) ? (s as TaskStatus) : "NOT_STARTED");

/** Counts by status, overdue, and a per-meeting done/total breakdown (newest meeting first, meetings without tasks kept). */
export function aggregateSeriesProgress(tasks: readonly ProgressTask[], meetings: readonly ProgressMeeting[], today: string): SeriesProgress {
  const counts: Record<TaskStatus, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
  const per = new Map<string, MeetingProgress>();
  for (const m of meetings) if (!per.has(m.meetingId)) per.set(m.meetingId, { ...m, done: 0, total: 0 });
  let overdue = 0;
  let total = 0;
  for (const t of tasks) {
    const m = per.get(t.meetingId);
    if (!m) continue;
    const status = asStatus(t.status);
    counts[status]++;
    total++;
    m.total++;
    if (status === "DONE") m.done++;
    if (isOverdue({ dueDate: t.dueDate, status }, today)) overdue++;
  }
  const list = [...per.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { counts, total, overdue, meetings: list };
}

/** "Weekly review · 12 done · 3 in progress · 2 overdue" (zero counts are left out, blocked is kept visible). */
export function progressLine(title: string, p: Pick<SeriesProgress, "counts" | "overdue" | "total">): string {
  if (p.total === 0) return `${title} · no tasks yet`;
  const parts = [title];
  if (p.counts.DONE) parts.push(`${p.counts.DONE} done`);
  if (p.counts.IN_PROGRESS) parts.push(`${p.counts.IN_PROGRESS} in progress`);
  if (p.counts.BLOCKED) parts.push(`${p.counts.BLOCKED} blocked`);
  if (p.counts.NOT_STARTED) parts.push(`${p.counts.NOT_STARTED} not started`);
  if (p.overdue) parts.push(`${p.overdue} overdue`);
  return parts.join(" · ");
}

/* ---------- owners ---------- */

export interface OwnerOption {
  value: string;
  label: string;
}

const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Owner filter choices: one per linked person (by id), one per distinct free-text name. Sorted by label. */
export function ownerOptions(items: readonly Pick<TaskRow, "owner" | "ownerStakeholderId">[]): OwnerOption[] {
  const seen = new Map<string, OwnerOption>();
  for (const t of items) {
    const name = t.owner?.trim();
    if (!name) continue;
    const k = t.ownerStakeholderId ? `p:${t.ownerStakeholderId}` : `t:${key(name)}`;
    if (!seen.has(k)) seen.set(k, { value: t.ownerStakeholderId ? `${OWNER_PERSON_PREFIX}${t.ownerStakeholderId}` : name, label: name });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export interface SeriesOption {
  id: string;
  title: string;
}

export function distinctSeries(items: readonly Pick<TaskRow, "series">[]): SeriesOption[] {
  const seen = new Map<string, SeriesOption>();
  for (const t of items) if (t.series && !seen.has(t.series.id)) seen.set(t.series.id, { id: t.series.id, title: t.series.title });
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export interface LinkMatch {
  personId: string;
  name: string;
  taskIds: string[];
}

export interface LinkPlan {
  matches: LinkMatch[];
  /** Owner names that match two or more people: left alone. */
  ambiguous: string[];
}

/**
 * Unlinked task owners whose text equals a person's name (case-insensitive, trimmed, exact). A name shared by two
 * people is never guessed: it is reported as ambiguous. Tasks that are already linked are skipped.
 */
export function matchOwnersToPeople(
  tasks: readonly { id: string; owner: string | null; ownerStakeholderId?: string | null }[],
  people: readonly { id: string; name: string }[]
): LinkPlan {
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const p of people) {
    const k = key(p.name);
    if (!k) continue;
    const list = byName.get(k);
    if (list) list.push(p);
    else byName.set(k, [p]);
  }
  const hits = new Map<string, LinkMatch>();
  const ambiguous = new Set<string>();
  for (const t of tasks) {
    if (t.ownerStakeholderId) continue;
    const k = key(t.owner);
    if (!k) continue;
    const cands = byName.get(k);
    if (!cands) continue;
    if (cands.length > 1) {
      ambiguous.add(t.owner!.trim());
      continue;
    }
    const p = cands[0];
    const m = hits.get(p.id);
    if (m) m.taskIds.push(t.id);
    else hits.set(p.id, { personId: p.id, name: p.name, taskIds: [t.id] });
  }
  return {
    matches: [...hits.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ambiguous: [...ambiguous].sort((a, b) => a.localeCompare(b)),
  };
}
