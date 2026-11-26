"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel, PanelHeader, Badge, selectCls, cx } from "./ui";
import { useToast } from "./Toast";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { carriedCount, carriedLabel } from "@/lib/followUp";
import { STATUSES, STATUS_LABEL, isOverdue, localToday, type TaskRow, type TaskStatus } from "@/lib/taskTracker";

const TONE = { NOT_STARTED: "neutral", IN_PROGRESS: "accent", BLOCKED: "danger", DONE: "success" } as const;

/**
 * "Carried-over tasks" on a plan made by "Plan next meeting": the still-open tasks of the meeting(s) it follows,
 * live from the tracker, with a quick status change so progress can be updated while preparing. Finished tasks drop
 * off. Needs internet; renders nothing when switched off, not migrated, offline, or when nothing is carried.
 */
export function CarriedTasksPanel({ planId, agenda }: { planId: string; agenda: string | null }) {
  const followOn = useFlag("followUpPlanning");
  const plansOn = useFlag("plannedMeetings");
  const tasksOn = useFlag("taskTracker");
  const online = useConnectivity() !== "offline";
  const toast = useToast();
  const [items, setItems] = useState<TaskRow[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const active = followOn && plansOn && tasksOn && online;
  const count = carriedCount(agenda);

  const load = useCallback(async () => {
    try {
      const cr = await fetch(`/api/plans/${encodeURIComponent(planId)}/carried-tasks`, { cache: "no-store" });
      if (!cr.ok) return setItems(null);
      const { meetingIds } = (await cr.json()) as { meetingIds?: string[] };
      const ids = new Set(meetingIds ?? []);
      if (!ids.size) return setItems([]);
      const tr = await fetch("/api/action-items?status=open", { cache: "no-store" });
      if (!tr.ok) return setItems(null);
      const { items: all } = (await tr.json()) as { items?: TaskRow[] };
      setItems((all ?? []).filter((t) => ids.has(t.meeting.id) && t.status !== "DONE"));
    } catch {
      setItems(null);
    }
  }, [planId]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  if (!active || count === 0 || !items) return null;

  const change = async (t: TaskRow, status: TaskStatus) => {
    if (pending || status === t.status) return;
    setPending(t.id);
    try {
      const res = await fetch(`/api/action-items/${encodeURIComponent(t.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(j?.error || "Couldn't update the task. Try again.", "danger");
        return;
      }
      setItems((list) => (list ? (status === "DONE" ? list.filter((x) => x.id !== t.id) : list.map((x) => (x.id === t.id ? { ...x, status } : x))) : list));
      if (status === "DONE") toast("Marked done", "success");
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setPending(null);
    }
  };

  const today = localToday();
  return (
    <Panel aria-label="Carried-over tasks">
      <PanelHeader title="Carried-over tasks" meta={carriedLabel(count)} />
      <div className="p-4">
        {items.length === 0 ? (
          <p className="text-ui text-muted-foreground">All carried-over tasks are done.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {items.map((t) => {
              const late = isOverdue(t, today);
              return (
                <li key={t.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-ui font-semibold">{t.task}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                      <Badge tone={t.owner ? "accent" : "neutral"}>{t.owner ?? "Unassigned"}</Badge>
                      <Badge tone={TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      {late && <Badge tone="warning">Overdue</Badge>}
                      <span>{t.deadlineText ?? "No deadline"}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:shrink-0">
                    <label className="sr-only" htmlFor={`carried-${t.id}`}>
                      Status of {t.task}
                    </label>
                    <select
                      id={`carried-${t.id}`}
                      value={t.status}
                      disabled={pending === t.id}
                      onChange={(e) => void change(t, e.target.value as TaskStatus)}
                      className={cx(selectCls, "sm:w-44")}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-meta text-muted-foreground">
          Changes here update the task everywhere. <Link href="/tasks" className="font-semibold text-accent-text underline underline-offset-2">Open Tasks</Link>
        </p>
      </div>
    </Panel>
  );
}
