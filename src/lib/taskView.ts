import { STATUS_LABEL, dueDay, isOverdue, type StatusFilter, type TaskRow, type TaskStatus } from "./taskTracker.ts";

/** Pure view helpers for the Tasks screen (overview strip, empty text, due-date label). */

export interface OverviewItem {
  key: "open" | TaskStatus;
  label: string;
  count: number;
  /** The status filter this tile stands for. */
  filter: StatusFilter;
}

/** Open, then each real status, from the counts `statusCounts` returns. No invented states. */
export function statusOverview(c: Record<StatusFilter, number>): OverviewItem[] {
  return [
    { key: "open", label: "Open", count: c.open, filter: "open" },
    { key: "NOT_STARTED", label: STATUS_LABEL.NOT_STARTED, count: c.NOT_STARTED, filter: "NOT_STARTED" },
    { key: "IN_PROGRESS", label: STATUS_LABEL.IN_PROGRESS, count: c.IN_PROGRESS, filter: "IN_PROGRESS" },
    { key: "BLOCKED", label: STATUS_LABEL.BLOCKED, count: c.BLOCKED, filter: "BLOCKED" },
    { key: "DONE", label: STATUS_LABEL.DONE, count: c.DONE, filter: "DONE" },
  ];
}

/** What to say when the list is empty. `narrowed` means an owner, meeting or series filter is on. */
export function emptyTasksText(status: StatusFilter, narrowed: boolean): string {
  if (narrowed) return "No tasks match these filters.";
  switch (status) {
    case "open":
      return "No open tasks. You're all caught up.";
    case "NOT_STARTED":
      return "Nothing is waiting to start.";
    case "IN_PROGRESS":
      return "Nothing is in progress right now.";
    case "BLOCKED":
      return "Nothing is blocked.";
    case "DONE":
      return "No finished tasks yet.";
    default:
      return "Tasks from your meetings will appear here.";
  }
}

export interface DueView {
  /** A day as "YYYY-MM-DD", or "" when the task has none. */
  day: string;
  overdue: boolean;
  /** What the person said in the meeting ("by Friday") when there is no date. */
  said: string | null;
}

export function dueView(t: Pick<TaskRow, "dueDate" | "status" | "deadlineText">, today: string): DueView {
  const day = dueDay(t.dueDate);
  return { day, overdue: isOverdue(t, today), said: !day && t.deadlineText ? t.deadlineText : null };
}
