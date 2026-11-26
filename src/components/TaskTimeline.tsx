"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarCheck } from "lucide-react";
import { Badge, Panel, PanelHeader, cx } from "./ui";
import { STATUS_LABEL, dueDay, type TaskRow } from "@/lib/taskTracker";
import { groupTimeline } from "@/lib/trackerPlus";

const STATUS_TONE = { NOT_STARTED: "neutral", IN_PROGRESS: "accent", BLOCKED: "danger", DONE: "success" } as const;

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Open tasks grouped by when they are due: Overdue, Today, This week, Next week, Later, No date.
 * Compact rows; tapping a task title opens it in the List view, where it can be edited.
 */
export function TaskTimeline({
  items, today, showDone, onShowDone, onOpen,
}: {
  items: TaskRow[];
  today: string;
  showDone: boolean;
  onShowDone: (v: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const groups = groupTimeline(items, today, showDone);
  const doneCount = items.filter((t) => t.status === "DONE").length;

  return (
    <div className="space-y-4">
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-ui font-medium">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={showDone}
          onChange={(e) => onShowDone(e.target.checked)}
        />
        Show done
        <span className="tabular-nums text-meta text-muted-foreground">{doneCount}</span>
      </label>

      {groups.length === 0 ? (
        <Panel className="p-6 text-center">
          <CalendarCheck className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-ui text-muted-foreground">Nothing open here. Everything matching these filters is done.</p>
        </Panel>
      ) : (
        groups.map((g) => (
          <Panel key={g.section} aria-label={g.label}>
            <PanelHeader title={g.label} meta={String(g.items.length)} />
            <ul className="divide-y divide-border/70">
              {g.items.map((t) => {
                const day = dueDay(t.dueDate);
                const late = g.section === "overdue";
                return (
                  <li key={t.id} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        aria-label={`Open ${t.task} in the list`}
                        className={cx(
                          "group inline-flex max-w-full items-start gap-1 text-left text-ui font-semibold hover:underline",
                          t.status === "DONE" && "text-muted-foreground line-through"
                        )}
                      >
                        <span className="break-words">{t.task}</span>
                        <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                      </button>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                        <Link
                          href={`/meeting?id=${encodeURIComponent(t.meeting.id)}`}
                          className="max-w-full truncate underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {t.meeting.title}
                        </Link>
                        {t.series && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="max-w-full truncate">{t.series.title}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
                      <span title={t.ownerDesignation ? `${t.owner} · ${t.ownerDesignation}` : undefined} className="max-w-[12rem] truncate">
                        <Badge tone={t.owner ? "accent" : "neutral"}>{t.owner || "Unassigned"}</Badge>
                      </span>
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      <span className={cx("min-w-[6.5rem] text-meta tabular-nums lg:text-right", late ? "font-semibold text-danger-text" : "text-muted-foreground")}>
                        {day ? dayLabel(day) : t.deadlineText ? `Said: ${t.deadlineText}` : "No date"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
