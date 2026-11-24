import { z } from "zod";

/** Pure helpers for the task tracker. Only zod is imported, so node:test can load this file. */

export const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

/** What the status filter can be: "open" is everything not done. */
export type StatusFilter = "open" | "all" | TaskStatus;
export const STATUS_FILTERS: StatusFilter[] = ["open", "NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE", "all"];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  open: "All open",
  all: "All",
  ...STATUS_LABEL,
};

export const UNASSIGNED = "__unassigned__";

export interface TaskRow {
  id: string;
  task: string;
  owner: string | null;
  deadlineText: string | null;
  /** ISO timestamp (UTC midnight of the due day) or null. */
  dueDate: string | null;
  sourceQuote: string;
  status: TaskStatus;
  note: string | null;
  createdAt: string;
  meeting: { id: string; title: string; createdAt: string };
}

export const isTaskStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export function parseStatusFilter(v: string | null | undefined): StatusFilter {
  if (v === "all" || v === "open") return v;
  return isTaskStatus(v) ? v : "open";
}

/* ---------- dates ---------- */

/** Parse "YYYY-MM-DD" (a real calendar date) to a Date at UTC midnight, else null. */
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** The calendar day ("YYYY-MM-DD") of a stored due date, or "" when none/invalid. */
export function dueDay(dueDate: string | null | undefined): string {
  if (!dueDate) return "";
  const t = new Date(dueDate);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10);
}

/** Today's local calendar day as "YYYY-MM-DD". */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Overdue: has a due day before today and is not done. A task due today is not overdue. */
export function isOverdue(t: { dueDate: string | null; status: TaskStatus }, today: string): boolean {
  if (t.status === "DONE") return false;
  const d = dueDay(t.dueDate);
  return !!d && d < today;
}

/* ---------- sorting, filtering, counting ---------- */

type Sortable = Pick<TaskRow, "status" | "dueDate" | "createdAt">;

/** Not done first, then due date ascending (none last), then newest created first. */
export function compareTasks(a: Sortable, b: Sortable): number {
  const ad = a.status === "DONE" ? 1 : 0;
  const bd = b.status === "DONE" ? 1 : 0;
  if (ad !== bd) return ad - bd;
  const da = dueDay(a.dueDate);
  const db = dueDay(b.dueDate);
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function sortTasks<T extends Sortable>(items: T[]): T[] {
  return items.slice().sort(compareTasks);
}

export interface TaskFilters {
  status: StatusFilter;
  /** An owner name, UNASSIGNED, or "" for any. */
  owner: string;
  /** A meeting id or "" for any. */
  meetingId: string;
}

const ownerKey = (o: string | null | undefined) => (o ?? "").trim().toLowerCase();

export function matchesFilters(t: TaskRow, f: TaskFilters): boolean {
  if (f.status === "open" ? t.status === "DONE" : f.status !== "all" && t.status !== f.status) return false;
  if (f.owner === UNASSIGNED) {
    if (ownerKey(t.owner) !== "") return false;
  } else if (f.owner && ownerKey(t.owner) !== ownerKey(f.owner)) return false;
  if (f.meetingId && t.meeting.id !== f.meetingId) return false;
  return true;
}

export function filterTasks(items: TaskRow[], f: TaskFilters): TaskRow[] {
  return items.filter((t) => matchesFilters(t, f));
}

/** Per-status counts, applying the owner and meeting filters but not the status one. */
export function statusCounts(items: TaskRow[], f: Pick<TaskFilters, "owner" | "meetingId">): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { open: 0, all: 0, NOT_STARTED: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
  for (const t of items) {
    if (!matchesFilters(t, { ...f, status: "all" })) continue;
    out.all++;
    out[t.status]++;
    if (t.status !== "DONE") out.open++;
  }
  return out;
}

/** Distinct owner names (case-insensitive, first spelling wins), sorted. */
export function distinctOwners(items: Pick<TaskRow, "owner">[]): string[] {
  const seen = new Map<string, string>();
  for (const t of items) {
    const o = t.owner?.trim();
    if (o && !seen.has(ownerKey(o))) seen.set(ownerKey(o), o);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Meetings that have tasks, newest first. */
export function distinctMeetings(items: Pick<TaskRow, "meeting">[]): { id: string; title: string }[] {
  const seen = new Map<string, { id: string; title: string; createdAt: string }>();
  for (const t of items) if (!seen.has(t.meeting.id)) seen.set(t.meeting.id, t.meeting);
  return [...seen.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(({ id, title }) => ({ id, title }));
}

/* ---------- PATCH body ---------- */

const trimmedOrNull = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

/** Accepts "YYYY-MM-DD" or a full ISO timestamp (its date part is kept), or null/"" to clear. */
const dueDateField = z
  .string()
  .nullable()
  .transform((v, ctx) => {
    const s = (v ?? "").trim();
    if (!s) return null;
    const day = parseDateOnly(s.slice(0, 10));
    if (!day || (s.length > 10 && Number.isNaN(new Date(s).getTime()))) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return day;
  });

export const PatchBody = z
  .object({
    status: z.enum(STATUSES),
    owner: trimmedOrNull(100),
    dueDate: dueDateField,
    note: trimmedOrNull(1000),
    task: z.string().trim().min(1).max(300),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Nothing to update" });
