"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CloudOff, Copy, Link2, ListChecks } from "lucide-react";
import { useConnectivity } from "@/lib/connectivity";
import { useToast } from "./Toast";
import { AgendaButton, FollowUpAgendaSheet } from "./FollowUpAgenda";
import { Button, Notice, Panel, Segmented, cx, selectCls } from "./ui";
import { TaskTimeline } from "./TaskTimeline";
import { STATUS_TONE, TaskDetail, formatDue, type Patch } from "./TaskDetail";
import { useFlag } from "@/lib/flagsClient";
import { usePeople, invalidatePeople } from "@/lib/stakeholdersClient";
import { invalidateOverdue } from "@/lib/overdueClient";
import {
  STATUS_FILTERS, STATUS_FILTER_LABEL, STATUS_LABEL, UNASSIGNED,
  distinctMeetings, dueDay, filterTasks, localToday, parseStatusFilter, sortTasks, statusCounts,
  type StatusFilter, type TaskRow,
} from "@/lib/taskTracker";
import { dueView, emptyTasksText, statusOverview } from "@/lib/taskView";
import { distinctSeries, matchOwnersToPeople, ownerOptions } from "@/lib/trackerPlus";
import { findTaskDuplicates } from "@/lib/dedupe";

type View = "list" | "timeline";

/** Body of a PATCH: the due day goes up as a plain "YYYY-MM-DD". */
function toBody(p: Patch): Record<string, unknown> {
  const b: Record<string, unknown> = { ...p };
  if ("dueDate" in p) b.dueDate = dueDay(p.dueDate) || null;
  return b;
}

/** One compact row. The title button opens the detail panel; the meeting link sits above its stretched hit area. */
function TaskRowItem({
  item, today, onOpen, dupOf, wide,
}: {
  item: TaskRow;
  today: string;
  onOpen: (id: string) => void;
  dupOf?: string;
  wide: string;
}) {
  const done = item.status === "DONE";
  const due = dueView(item, today);
  return (
    <li id={`task-${item.id}`} tabIndex={-1} className="relative outline-none focus-visible:ring-2 focus-visible:ring-accent hover:bg-muted/50">
      <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 lg:grid lg:items-center", wide)}>
        <div className="min-w-0 basis-full lg:basis-auto">
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            aria-label={`Open task: ${item.task}`}
            className={cx(
              "line-clamp-2 break-words text-left text-ui font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none",
              done && "text-muted-foreground line-through"
            )}
          >
            {item.task}
          </button>
          {dupOf && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-meta font-semibold text-warning-text">
              <Copy className="h-3 w-3" aria-hidden /> Possible duplicate
            </span>
          )}
        </div>
        <span className={cx("min-w-0 truncate text-meta", item.owner?.trim() ? "text-foreground" : "text-muted-foreground")} title={item.owner ?? undefined}>
          {item.owner?.trim() || "Unassigned"}
        </span>
        <span className={cx("text-meta", due.overdue ? "font-semibold text-danger-text" : "text-muted-foreground")}>
          {due.day ? (
            <>
              <span className="num">{formatDue(due.day)}</span>
              {due.overdue && <span> · Overdue</span>}
            </>
          ) : due.said ? (
            <span className="line-clamp-1">Said: {due.said}</span>
          ) : (
            "No due date"
          )}
        </span>
        <span className={cx("inline-flex h-6 w-fit items-center rounded-full px-2 text-meta font-semibold", STATUS_TONE[item.status])}>
          {STATUS_LABEL[item.status]}
        </span>
        <Link
          href={`/meeting?id=${encodeURIComponent(item.meeting.id)}`}
          className="relative z-10 min-w-0 max-w-full truncate text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title={item.meeting.title}
        >
          {item.meeting.title}
        </Link>
      </div>
    </li>
  );
}

function TaskTrackerInner() {
  const search = useSearchParams();
  const toast = useToast();
  const conn = useConnectivity();
  const offline = conn === "offline";
  const [items, setItems] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>(() => parseStatusFilter(search.get("status")));
  const [owner, setOwner] = useState(() => search.get("owner") ?? "");
  const [meetingId, setMeetingId] = useState(() => search.get("meetingId") ?? "");
  const plusOn = useFlag("trackerPlus");
  const [view, setView] = useState<View>(() => (search.get("view") === "timeline" ? "timeline" : "list"));
  const [seriesId, setSeriesId] = useState(() => search.get("series") ?? "");
  const [showDone, setShowDone] = useState(false);
  const timeline = plusOn && view === "timeline";
  const directory = usePeople(plusOn);
  const peopleRef = useRef(directory.people);
  useEffect(() => {
    peopleRef.current = directory.people;
  }, [directory.people]);

  const itemsRef = useRef<TaskRow[] | null>(null);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/action-items", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Couldn't load the tasks. Try again.");
        setItems((cur) => cur ?? []);
        return;
      }
      setError(null);
      setItems(((await res.json()) as { items: TaskRow[] }).items);
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
      setItems((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    if (!offline) void load();
  }, [load, offline]);

  // Keep the filters in the address so a link (and a reload) lands on the same view.
  useEffect(() => {
    const q = new URLSearchParams();
    if (status !== "open") q.set("status", status);
    if (owner) q.set("owner", owner);
    if (meetingId) q.set("meetingId", meetingId);
    if (seriesId) q.set("series", seriesId);
    if (timeline) q.set("view", "timeline");
    const s = q.toString();
    window.history.replaceState(window.history.state, "", s ? `/tasks?${s}` : "/tasks");
  }, [status, owner, meetingId, seriesId, timeline]);

  const patch = useCallback(
    async (id: string, p: Patch) => {
      const before = itemsRef.current?.find((i) => i.id === id);
      // Typing a different owner as plain text unlinks the person.
      if ("owner" in p && !("ownerStakeholderId" in p) && before?.ownerStakeholderId) p = { ...p, ownerStakeholderId: null };
      const designation = p.ownerStakeholderId ? (peopleRef.current.find((x) => x.id === p.ownerStakeholderId)?.designation ?? null) : null;
      const extra: Partial<TaskRow> = "ownerStakeholderId" in p ? { ownerDesignation: designation } : {};
      setItems((cur) => (cur ? sortTasks(cur.map((i) => (i.id === id ? { ...i, ...p, ...extra } : i))) : cur));
      try {
        const res = await fetch(`/api/action-items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toBody(p)),
        });
        if (!res.ok) throw new Error("update failed");
        bump(id);
        if ("status" in p || "dueDate" in p) invalidateOverdue();
      } catch {
        // Put back only the fields this edit touched.
        setItems((cur) => {
          if (!cur || !before) return cur;
          const old = before;
          const restore: Patch = {};
          const now = cur.find((i) => i.id === id);
          // Skip a field a newer edit has since changed, so a late failure can't undo it.
          for (const k of Object.keys(p) as (keyof Patch)[]) if (now && now[k] === p[k]) (restore as Record<string, unknown>)[k] = old[k];
          const back: Partial<TaskRow> = "ownerStakeholderId" in restore ? { ownerDesignation: old.ownerDesignation ?? null } : {};
          return sortTasks(cur.map((i) => (i.id === id ? { ...i, ...restore, ...back } : i)));
        });
        toast("Couldn't update the task. Try again.", "danger");
      }
    },
    [toast]
  );

  const [revs, setRevs] = useState<Record<string, number>>({});
  const bump = (id: string) => setRevs((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));

  const remove = useCallback(
    async (id: string) => {
      const before = itemsRef.current;
      setItems((cur) => (cur ? cur.filter((i) => i.id !== id) : cur));
      try {
        const res = await fetch(`/api/action-items/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error("delete failed");
        toast("Task deleted", "success");
        invalidateOverdue();
      } catch {
        setItems(before ?? null);
        toast("Couldn't delete the task. Try again.", "danger");
      }
    },
    [toast]
  );

  const jumpTo = (id: string) => {
    const el = document.getElementById(`task-${id}`);
    if (!el) {
      toast("The other task is hidden by the current filters.", "neutral");
      return;
    }
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  };

  const all = useMemo(() => items ?? [], [items]);
  const dups = useMemo(() => findTaskDuplicates(all), [all]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  const seriesList = useMemo(() => distinctSeries(all), [all]);
  // Only offered once 7_tracker is applied (the server then sends ownerStakeholderId on every task, null when unlinked).
  const migrated = useMemo(() => all.some((t) => t.ownerStakeholderId !== undefined), [all]);
  const linkPlan = useMemo(
    () => (plusOn && migrated && directory.status === "ready" ? matchOwnersToPeople(all, directory.people) : null),
    [plusOn, migrated, directory.status, directory.people, all]
  );
  const meetings = useMemo(() => distinctMeetings(all), [all]);
  const hasUnassigned = useMemo(() => all.some((t) => !t.owner?.trim()), [all]);
  const counts = useMemo(() => statusCounts(all, { owner, meetingId, seriesId }), [all, owner, meetingId, seriesId]);
  // The timeline has its own "Show done" switch instead of the status chips.
  const shown = useMemo(
    () => filterTasks(all, { status: timeline ? "all" : status, owner, meetingId, seriesId }),
    [all, status, owner, meetingId, seriesId, timeline]
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const linkOwners = async () => {
    if (!linkPlan || linking) return;
    setLinking(true);
    try {
      const res = await fetch("/api/action-items/link-owners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds: linkPlan.matches.map((m) => m.personId) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(j?.error ?? "Couldn't link the owners. Try again.", "danger");
        return;
      }
      const j = (await res.json()) as { linked?: number };
      toast(`Linked ${j.linked ?? 0} ${j.linked === 1 ? "task" : "tasks"} to People`, "success");
      setLinkOpen(false);
      invalidatePeople();
      await load();
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setLinking(false);
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (all.find((t) => t.id === selectedId) ?? null) : null;
  const jumpToDuplicate = (id: string) => {
    setSelectedId(null);
    setView("list");
    setStatus("all");
    window.setTimeout(() => jumpTo(id), 60);
  };
  const today = localToday();
  const [agendaOpen, setAgendaOpen] = useState(false);
  const agendaTitle = meetingId ? (meetings.find((m) => m.id === meetingId)?.title ?? null) : null;
  const wide = "lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_7rem_minmax(0,1.3fr)]";
  const narrowed = Boolean(owner || meetingId || seriesId);
  const overview = useMemo(() => statusOverview(counts), [counts]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-ui text-muted-foreground">Action items from your meetings. Keep commitments moving.</p>
        </div>
        {plusOn && items && items.length > 0 && (
          <Segmented<View>
            label="View"
            value={view}
            onChange={setView}
            className="w-full sm:w-60"
            options={[
              { value: "list", label: "List" },
              { value: "timeline", label: "Timeline" },
            ]}
          />
        )}
      </div>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="Tasks need internet for now">
          {items?.length ? "You are seeing the last tasks loaded. Changes are paused until you are back online." : "Connect to see and update your tasks."}
        </Notice>
      )}
      {error && !offline && (
        <p className="text-meta text-danger-text" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        offline ? null : <p className="text-ui text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        !offline && !error && (
          <Panel className="p-6 text-center">
            <ListChecks className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-ui font-semibold">No tasks yet.</p>
            <p className="mt-1 text-meta text-muted-foreground">Tasks from your meetings will appear here. Open a meeting and use Extract action items.</p>
            <Link
              href="/meetings"
              className="mt-4 inline-flex min-h-11 items-center rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted"
            >
              Go to Meetings
            </Link>
          </Panel>
        )
      ) : (
        <>
          {linkPlan && linkPlan.matches.length > 0 && !offline && (
            <Notice tone="accent" icon={<Link2 className="h-4 w-4" aria-hidden />} title="Link owners to People">
              <p className="text-meta">
                {linkPlan.matches.reduce((n, m) => n + m.taskIds.length, 0)} tasks have an owner whose name matches someone in People. Linking means a rename
                in People shows up here too.
              </p>
              {linkOpen ? (
                <div className="mt-2 space-y-2">
                  <ul className="space-y-0.5 text-meta">
                    {linkPlan.matches.map((m) => (
                      <li key={m.personId}>
                        <span className="font-semibold">{m.name}</span> · {m.taskIds.length} {m.taskIds.length === 1 ? "task" : "tasks"}
                      </li>
                    ))}
                  </ul>
                  {linkPlan.ambiguous.length > 0 && (
                    <p className="text-meta text-muted-foreground">Left alone (two people share the name): {linkPlan.ambiguous.join(", ")}.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" loading={linking} onClick={() => void linkOwners()}>
                      Confirm and link
                    </Button>
                    <Button variant="ghost" onClick={() => setLinkOpen(false)} disabled={linking}>
                      Not now
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2">
                  <Button onClick={() => setLinkOpen(true)}>Review matches</Button>
                </div>
              )}
            </Notice>
          )}

          <dl aria-label="Task overview" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {overview.map((o) => (
              <div key={o.key} className="rounded-panel border border-border/70 bg-card px-3 py-2 shadow-card dark:border-border">
                <dt className="truncate text-meta text-muted-foreground">{o.label}</dt>
                <dd className={cx("num text-xl font-semibold", o.key === "BLOCKED" && o.count > 0 && "text-danger-text")}>{o.count}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-3">
            {!timeline && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
              {STATUS_FILTERS.map((s) => {
                const on = s === status;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStatus(s)}
                    className={cx(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-ui font-semibold transition-[background-color,transform] duration-[var(--dur-1)] active:scale-[0.96] lg:min-h-9",
                      on ? "bg-accent-soft text-accent-text" : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {STATUS_FILTER_LABEL[s]}
                    <span className="tabular-nums text-meta">{counts[s]}</span>
                  </button>
                );
              })}
            </div>
            )}
            <div className={cx("grid gap-3 sm:grid-cols-2", seriesList.length > 0 && plusOn ? "lg:max-w-4xl lg:grid-cols-3" : "lg:max-w-2xl")}>
              <div>
                <label className="mb-1 block text-meta font-semibold" htmlFor="filter-owner">
                  Owner
                </label>
                <select id="filter-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={selectCls}>
                  <option value="">Everyone</option>
                  {hasUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
                  {owners.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {owner && owner !== UNASSIGNED && !owners.some((o) => o.value === owner) && <option value={owner}>{owner.startsWith("p:") ? "This person" : owner}</option>}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-meta font-semibold" htmlFor="filter-meeting">
                  Meeting
                </label>
                <select id="filter-meeting" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={selectCls}>
                  <option value="">All meetings</option>
                  {meetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                  {meetingId && !meetings.some((m) => m.id === meetingId) && <option value={meetingId}>This meeting</option>}
                </select>
              </div>
              {plusOn && (seriesList.length > 0 || seriesId) && (
                <div>
                  <label className="mb-1 block text-meta font-semibold" htmlFor="filter-series">
                    Series
                  </label>
                  <select id="filter-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={selectCls}>
                    <option value="">All series</option>
                    {seriesList.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                    {seriesId && !seriesList.some((x) => x.id === seriesId) && <option value={seriesId}>This series</option>}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div>
            <AgendaButton onClick={() => setAgendaOpen(true)} disabled={shown.length === 0} className="w-full sm:w-auto" />
          </div>

          {timeline ? (
            <div className={cx(offline && "pointer-events-none opacity-60")}>
              <TaskTimeline items={shown} today={today} showDone={showDone} onShowDone={setShowDone} onOpen={setSelectedId} />
            </div>
          ) : (
          <Panel aria-label="Tasks">
            <div
              className={cx("hidden gap-3 border-b border-border/70 px-4 py-2 text-meta font-semibold text-muted-foreground lg:grid", wide)}
              aria-hidden
            >
              <span>Task</span>
              <span>Owner</span>
              <span>Due date</span>
              <span>Status</span>
              <span>Source meeting</span>
            </div>
            {shown.length === 0 ? (
              <p className="p-5 text-ui text-muted-foreground">{emptyTasksText(status, narrowed)}</p>
            ) : (
              <ul className={cx("divide-y divide-border/70", offline && "pointer-events-none opacity-60")}>
                {shown.map((t) => (
                  <TaskRowItem key={t.id} item={t} today={today} onOpen={setSelectedId} dupOf={dups.get(t.id)} wide={wide} />
                ))}
              </ul>
            )}
          </Panel>
          )}
        </>
      )}
      {selected && (
        <TaskDetail
          key={selected.id}
          item={selected}
          today={today}
          offline={offline}
          rev={revs[selected.id] ?? 0}
          dupOf={dups.get(selected.id)}
          onPatch={(id, p) => void patch(id, p)}
          onDelete={(id) => {
            setSelectedId(null);
            void remove(id);
          }}
          onClose={() => setSelectedId(null)}
          onSeries={setSeriesId}
          onJump={jumpToDuplicate}
        />
      )}
      <FollowUpAgendaSheet
        open={agendaOpen}
        onClose={() => setAgendaOpen(false)}
        items={shown}
        meetingTitle={agendaTitle}
        meetingId={meetingId || null}
      />
    </div>
  );
}

export function TaskTracker() {
  return (
    <Suspense fallback={<p className="text-ui text-muted-foreground">Loading…</p>}>
      <TaskTrackerInner />
    </Suspense>
  );
}
