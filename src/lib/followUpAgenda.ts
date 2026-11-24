import { z } from "zod";

/** Pure helpers for the follow-up agenda. No imports beyond zod, so node:test can load this file. */

export const MAX_AGENDA_CHARS = 8000;

export interface AgendaItem {
  task: string;
  owner: string | null;
  /** ISO timestamp (UTC midnight of the due day) or null. */
  dueDate: string | null;
  /** Deadline as spoken in the meeting, e.g. "by Friday". */
  deadlineText: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayOf(dueDate: string | null): string {
  if (!dueDate) return "";
  const t = new Date(dueDate);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10);
}

/** "2026-11-24" -> "24 Nov 2026". Fixed format so the draft never depends on the device locale. */
function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const NEEDS_OWNER = " — needs an owner";

/**
 * A plain-text agenda from the unfinished tasks. Order: blocked, overdue, in progress, not started,
 * then "Any new discussion topics". Done tasks are left out. `today` is "YYYY-MM-DD".
 */
export function buildAgendaDraft(
  items: AgendaItem[],
  opts: { meetingTitle?: string | null; today: string }
): string {
  const title = opts.meetingTitle?.trim() || "Selected tasks";
  const open = items.filter((i) => i.status !== "DONE" && i.task.trim());
  const owner = (i: AgendaItem) => i.owner?.trim() || "";
  const flag = (i: AgendaItem) => (owner(i) ? "" : NEEDS_OWNER);

  const blocked = open.filter((i) => i.status === "BLOCKED");
  const rest = open.filter((i) => i.status !== "BLOCKED");
  const isLate = (i: AgendaItem) => {
    const d = dayOf(i.dueDate);
    return !!d && d < opts.today;
  };
  const overdue = rest.filter(isLate);
  const inProgress = rest.filter((i) => !isLate(i) && i.status === "IN_PROGRESS");
  const notStarted = rest.filter((i) => !isLate(i) && i.status === "NOT_STARTED");

  const points: string[] = [];
  for (const i of blocked) {
    points.push(`Discuss the blocked ${i.task.trim()}${owner(i) ? ` (${owner(i)})` : ""}${flag(i)}`);
  }
  for (const i of overdue) {
    const who = owner(i) ? `${owner(i)}, ` : "";
    points.push(`Confirm a new date for ${i.task.trim()} — ${who}was due ${prettyDay(dayOf(i.dueDate))}${flag(i)}`);
  }
  for (const i of inProgress) {
    points.push(`Review progress on ${i.task.trim()}${owner(i) ? ` (${owner(i)})` : ""}${flag(i)}`);
  }
  for (const i of notStarted) {
    const due = dayOf(i.dueDate) ? prettyDay(dayOf(i.dueDate)) : i.deadlineText?.trim() || "";
    const bits = [owner(i), due ? `due ${due}` : ""].filter(Boolean).join(", ");
    points.push(`Check status of ${i.task.trim()}${bits ? ` (${bits})` : ""}${flag(i)}`);
  }
  points.push("Any new discussion topics");

  const lines = [`Follow-up agenda — ${title}`, ""];
  if (open.length === 0) lines.push("All tasks from this meeting are done.", "");
  points.forEach((p, n) => lines.push(`${n + 1}. ${p}`));
  return lines.join("\n");
}

export const PolishBody = z.object({ draft: z.string().trim().min(1).max(MAX_AGENDA_CHARS) });

export function buildPolishPrompt(draft: string): string {
  return `Rewrite the meeting follow-up agenda below so it reads more naturally.

Rules:
- Keep every numbered item and the same order.
- Do not add new tasks, owners, dates or topics, and do not drop any.
- Keep the title line and the final "Any new discussion topics" item.
- Return plain text only: no markdown, no code fences, no commentary.

Agenda:
${draft}`;
}

/** Strip a code fence and markdown emphasis the model may add despite instructions. */
export function cleanPolished(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) t = fence[1].trim();
  return t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
}

export function agendaFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `follow-up-agenda${slug ? `-${slug}` : ""}.txt`;
}
