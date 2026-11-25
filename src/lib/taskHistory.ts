/** Pure helpers for task change history. No imports, so node:test can load them. */

export const HISTORY_FIELDS = ["status", "owner", "dueDate", "note", "task"] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];
export type HistoryAction = "created" | "updated" | "deleted";

export const HISTORY_VALUE_MAX = 300;
export const HISTORY_PAGE = 5;
export const HISTORY_MAX = 20;

export interface HistoryEvent {
  id: string;
  action: HistoryAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface EventDraft {
  action: HistoryAction;
  field: HistoryField | null;
  oldValue: string | null;
  newValue: string | null;
}

const clip = (v: string | null): string | null => (v === null ? null : v.length > HISTORY_VALUE_MAX ? v.slice(0, HISTORY_VALUE_MAX) : v);

/** A stored comparable string for one field value: dates as YYYY-MM-DD, blanks as null. */
export function historyValue(field: HistoryField, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  if (field === "dueDate") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  const t = v.trim();
  return t ? t : null;
}

/** One "updated" event per field whose value really changed. Only fields present in `after` are compared. */
export function diffTask(before: Partial<Record<HistoryField, unknown>>, after: Partial<Record<HistoryField, unknown>>): EventDraft[] {
  const out: EventDraft[] = [];
  for (const f of HISTORY_FIELDS) {
    if (!(f in after)) continue;
    const o = historyValue(f, before[f]);
    const n = historyValue(f, after[f]);
    if (o === n) continue;
    out.push({ action: "updated", field: f, oldValue: clip(o), newValue: clip(n) });
  }
  return out;
}

const FIELD_LABEL: Record<HistoryField, string> = { status: "Status", owner: "Owner", dueDate: "Due date", note: "Note", task: "Task" };
const STATUS: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", BLOCKED: "Blocked", DONE: "Done" };

function showValue(field: string | null, v: string | null): string {
  if (v === null) return "none";
  if (field === "status") return STATUS[v] ?? v;
  if (field === "dueDate") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  return v.length > 80 ? `${v.slice(0, 80)}…` : v;
}

/** "Status: Not started → In progress" (without the time). */
export function describeEvent(e: Pick<HistoryEvent, "action" | "field" | "oldValue" | "newValue">): string {
  if (e.action === "created") return "Task saved";
  if (e.action === "deleted") return "Task deleted";
  const label = FIELD_LABEL[e.field as HistoryField] ?? e.field ?? "Task";
  return `${label}: ${showValue(e.field, e.oldValue)} → ${showValue(e.field, e.newValue)}`;
}

/** Newest first, capped. */
export function sortEvents<T extends { createdAt: string }>(events: readonly T[], max = HISTORY_MAX): T[] {
  return [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, max);
}
