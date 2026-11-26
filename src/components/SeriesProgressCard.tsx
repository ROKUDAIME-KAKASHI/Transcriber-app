"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Panel, PanelHeader, cx } from "./ui";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { localToday } from "@/lib/taskTracker";
import { progressLine, type SeriesProgress } from "@/lib/trackerPlus";

type Progress = SeriesProgress & { series: { id: string; title: string } };

const SEGMENTS = [
  { key: "DONE", label: "done", cls: "bg-success" },
  { key: "IN_PROGRESS", label: "in progress", cls: "bg-accent" },
  { key: "BLOCKED", label: "blocked", cls: "bg-danger" },
  { key: "NOT_STARTED", label: "not started", cls: "bg-muted-foreground/40" },
] as const;

/**
 * "Series progress" on a plan that belongs to a series: done, in progress and overdue tasks across every meeting
 * recorded from the series, with a per-meeting breakdown. Needs internet; renders nothing when switched off,
 * not migrated, offline or on any error.
 */
export function SeriesProgressCard({ seriesId }: { seriesId: string }) {
  const tasksOn = useFlag("taskTracker");
  const plusOn = useFlag("trackerPlus");
  const plansOn = useFlag("plannedMeetings");
  const online = useConnectivity() !== "offline";
  const [data, setData] = useState<Progress | null>(null);
  const [open, setOpen] = useState(false);
  const active = tasksOn && plusOn && plansOn && online;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetch(`/api/series/${encodeURIComponent(seriesId)}/progress?today=${localToday()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Progress | null) => {
        if (!cancelled) setData(j && j.counts ? j : null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, seriesId]);

  if (!active || !data) return null;
  const line = progressLine(data.series.title, data);
  const withTasks = data.meetings.filter((m) => m.total > 0);

  return (
    <Panel aria-label="Series progress">
      <PanelHeader title="Series progress" />
      <div className="space-y-3 p-4">
        <p className="break-words text-ui font-semibold">{line}</p>
        {data.total > 0 ? (
          <div
            role="img"
            aria-label={`${SEGMENTS.map((s) => `${data.counts[s.key]} ${s.label}`).join(", ")}${data.overdue ? `, ${data.overdue} overdue` : ""}`}
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          >
            {SEGMENTS.map((s) =>
              data.counts[s.key] ? <span key={s.key} className={s.cls} style={{ width: `${(data.counts[s.key] / data.total) * 100}%` }} /> : null
            )}
          </div>
        ) : (
          <p className="text-meta text-muted-foreground">Tasks from this series&apos; meetings will show up here once you save them.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {withTasks.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex min-h-11 items-center gap-1 rounded-btn text-ui font-semibold text-accent-text hover:underline"
            >
              By meeting
              <ChevronDown className={cx("h-4 w-4 transition-transform duration-[var(--dur-2)]", open && "rotate-180")} aria-hidden />
            </button>
          ) : (
            <span />
          )}
          {data.total > 0 && (
            <Link
              href={`/tasks?series=${encodeURIComponent(seriesId)}&status=all`}
              className="inline-flex min-h-11 items-center text-ui font-semibold text-accent-text underline-offset-2 hover:underline"
            >
              View tasks
            </Link>
          )}
        </div>
        {open && (
          <ul className="divide-y divide-border/70 rounded-chip border border-border/70">
            {withTasks.map((m) => (
              <li key={m.meetingId} className="flex items-center gap-3 px-3 py-2 text-meta">
                <span className="w-24 shrink-0 text-muted-foreground">
                  {new Date(m.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <Link href={`/meeting?id=${encodeURIComponent(m.meetingId)}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {m.title}
                </Link>
                <span className="shrink-0 tabular-nums">
                  {m.done}/{m.total} done
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
