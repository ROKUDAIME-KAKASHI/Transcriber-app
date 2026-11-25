"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronDown, CloudOff, Copy, ListChecks, Trash2 } from "lucide-react";
import { useConnectivity } from "@/lib/connectivity";
import { useToast } from "./Toast";
import { AgendaButton, FollowUpAgendaSheet } from "./FollowUpAgenda";
import { Badge, Button, Notice, Panel, cx, selectCls } from "./ui";
import {
  STATUSES, STATUS_FILTERS, STATUS_FILTER_LABEL, STATUS_LABEL, UNASSIGNED,
  distinctMeetings, distinctOwners, dueDay, filterTasks, isOverdue, localToday, parseStatusFilter, sortTasks, statusCounts,
  type StatusFilter, type TaskRow, type TaskStatus,
} from "@/lib/taskTracker";
import { findTaskDuplicates } from "@/lib/dedupe";
import { HISTORY_PAGE, describeEvent, type HistoryEvent } from "@/lib/taskHistory";

type Patch = Partial<Pick<TaskRow, "status" | "owner" | "dueDate" | "note" | "task">>;

const STATUS_TONE: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-muted text-foreground",
  IN_PROGRESS: "bg-accent-soft text-accent",
  BLOCKED: "bg-danger-soft text-danger",
  DONE: "bg-success-soft text-success",
};

const fieldCls =
  "min-h-11 w-full rounded-chip border border-transparent bg-muted px-3 text-base outline-none transition-[box-shadow,background-color] duration-[var(--dur-2)] placeholder:text-muted-foreground focus:ring-2 focus:ring-accent sm:text-ui lg:min-h-10";

/** Body of a PATCH: the due day goes up as a plain "YYYY-MM-DD". */
function toBody(p: Patch): Record<string, unknown> {
  const b: Record<string, unknown> = { ...p };
  if ("dueDate" in p) b.dueDate = dueDay(p.dueDate) || null;
  return b;
}

function formatDue(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function whenText(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Change history of one task. Hidden when the database has no history table yet or the request fails. */
function TaskHistory({ id, rev }: { id: string; rev: number }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/action-items/${id}/history`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: HistoryEvent[] | null } | null) => {
        if (live) setEvents(d?.events ?? null);
      })
      .catch(() => {
        if (live) setEvents(null);
      });
    return () => {
      live = false;
    };
  }, [id, rev]);
  if (!events) return null;
  const shown = more ? events : events.slice(0, HISTORY_PAGE);
  return (
    <div>
      <p className="mb-1 text-meta font-semibold text-muted-foreground">History</p>
      {events.length === 0 ? (
        <p className="text-meta text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((e) => (
            <li key={e.id} className="break-words text-meta text-muted-foreground">
              <span className="text-foreground">{describeEvent(e)}</span> · {whenText(e.createdAt)}
            </li>
          ))}
        </ul>
      )}
      {!more && events.length > HISTORY_PAGE && (
        <Button variant="ghost" className="mt-1" onClick={() => setMore(true)}>
          Show more
        </Button>
      )}
    </div>
  );
}

function TaskItem({
  item, today, onPatch, onDelete, dupOf, onJump, rev, wide,
}: {
  item: TaskRow;
  today: string;
  onPatch: (id: string, p: Patch) => void;
  onDelete: (id: string) => void;
  /** Another task in the same meeting that looks like this one. */
  dupOf?: string;
  onJump: (id: string) => void;
  rev: number;
  wide: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [note, setNote] = useState(item.note ?? "");
  useEffect(() => setOwner(item.owner ?? ""), [item.owner]);
  useEffect(() => setNote(item.note ?? ""), [item.note]);

  const done = item.status === "DONE";
  const overdue = isOverdue(item, today);
  const saveOwner = () => {
    const next = owner.trim();
    if (next !== (item.owner ?? "")) onPatch(item.id, { owner: next || null });
  };
  const saveNote = () => {
    const next = note.trim();
    if (next !== (item.note ?? "")) onPatch(item.id, { note: next || null });
  };

  return (
    <li id={`task-${item.id}`} tabIndex={-1} className="px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div className={cx("grid gap-3", wide)}>
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-muted-foreground hover:bg-muted lg:h-9 lg:w-9"
          >
            <ChevronDown className={cx("h-4 w-4 transition-transform duration-[var(--dur-2)]", open && "rotate-180")} aria-hidden />
          </button>
          <div className="min-w-0 pt-2.5 lg:pt-1.5">
            <p className={cx("break-words text-ui font-semibold", done && "text-muted-foreground line-through")}>{item.task}</p>
            {dupOf && (
              <button
                type="button"
                onClick={() => onJump(dupOf)}
                className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-chip bg-warning-soft px-2 text-meta font-semibold text-warning hover:opacity-90"
              >
                <Copy className="h-3 w-3" aria-hidden /> Possible duplicate. Show the other
              </button>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <label className="mb-1 block text-meta font-semibold text-muted-foreground lg:sr-only" htmlFor={`owner-${item.id}`}>
            Owner
          </label>
          <input
            id={`owner-${item.id}`}
            maxLength={100}
            value={owner}
            placeholder="Unassigned"
            onChange={(e) => setOwner(e.target.value)}
            onBlur={saveOwner}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={fieldCls}
          />
        </div>

        <div className="min-w-0">
          <label className="mb-1 block text-meta font-semibold text-muted-foreground lg:sr-only" htmlFor={`due-${item.id}`}>
            Due date
          </label>
          <input
            id={`due-${item.id}`}
            type="date"
            value={dueDay(item.dueDate)}
            onChange={(e) => onPatch(item.id, { dueDate: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
            className={fieldCls}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 empty:hidden">
            {overdue && (
              <Badge tone="danger">
                <AlertTriangle className="h-3 w-3" aria-hidden /> Overdue
              </Badge>
            )}
            {!item.dueDate && item.deadlineText && (
              <span className="text-meta text-muted-foreground">Said: {item.deadlineText}</span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <label className="mb-1 block text-meta font-semibold text-muted-foreground lg:sr-only" htmlFor={`status-${item.id}`}>
            Status
          </label>
          <select
            id={`status-${item.id}`}
            value={item.status}
            onChange={(e) => onPatch(item.id, { status: e.target.value as TaskStatus })}
            className={cx(selectCls, "!min-h-11 !rounded-full !border-transparent text-ui font-semibold lg:!min-h-10", STATUS_TONE[item.status])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 text-meta text-muted-foreground">
          <Link
            href={`/meeting?id=${encodeURIComponent(item.meeting.id)}`}
            className="line-clamp-2 break-words underline-offset-2 hover:text-foreground hover:underline"
          >
            {item.meeting.title}
          </Link>
          <span className="block">{new Date(item.meeting.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border/70 pt-3 lg:pl-9">
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-foreground" htmlFor={`note-${item.id}`}>
              Progress note
            </label>
            <textarea
              id={`note-${item.id}`}
              rows={2}
              maxLength={1000}
              value={note}
              placeholder="Add a short update"
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              className={cx(fieldCls, "resize-y py-2")}
            />
            <div className="mt-2">
              <Button onClick={saveNote} disabled={note.trim() === (item.note ?? "")}>
                Save note
              </Button>
            </div>
          </div>
          {item.sourceQuote && (
            <p className="break-words text-meta text-muted-foreground">
              <span className="font-semibold">Source: </span>&ldquo;{item.sourceQuote}&rdquo;
            </p>
          )}
          <TaskHistory id={item.id} rev={rev} />
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/meeting?id=${encodeURIComponent(item.meeting.id)}`}
              className="inline-flex min-h-11 items-center rounded-btn border border-border/70 bg-card px-4 text-ui font-semibold shadow-card hover:bg-muted"
            >
              Open meeting
            </Link>
            {confirmDelete ? (
              <>
                <Button variant="danger-solid" onClick={() => onDelete(item.id)}>
                  Confirm delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="danger" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
                Delete task
              </Button>
            )}
          </div>
        </div>
      )}
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
    const s = q.toString();
    window.history.replaceState(window.history.state, "", s ? `/tasks?${s}` : "/tasks");
  }, [status, owner, meetingId]);

  const patch = useCallback(
    async (id: string, p: Patch) => {
      const before = itemsRef.current?.find((i) => i.id === id);
      setItems((cur) => (cur ? sortTasks(cur.map((i) => (i.id === id ? { ...i, ...p } : i))) : cur));
      try {
        const res = await fetch(`/api/action-items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toBody(p)),
        });
        if (!res.ok) throw new Error("update failed");
        bump(id);
      } catch {
        // Put back only the fields this edit touched.
        setItems((cur) => {
          if (!cur || !before) return cur;
          const old = before;
          const restore: Patch = {};
          const now = cur.find((i) => i.id === id);
          // Skip a field a newer edit has since changed, so a late failure can't undo it.
          for (const k of Object.keys(p) as (keyof Patch)[]) if (now && now[k] === p[k]) (restore as Record<string, unknown>)[k] = old[k];
          return sortTasks(cur.map((i) => (i.id === id ? { ...i, ...restore } : i)));
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
  const owners = useMemo(() => distinctOwners(all), [all]);
  const meetings = useMemo(() => distinctMeetings(all), [all]);
  const hasUnassigned = useMemo(() => all.some((t) => !t.owner?.trim()), [all]);
  const counts = useMemo(() => statusCounts(all, { owner, meetingId }), [all, owner, meetingId]);
  const shown = useMemo(() => filterTasks(all, { status, owner, meetingId }), [all, status, owner, meetingId]);
  const today = localToday();
  const [agendaOpen, setAgendaOpen] = useState(false);
  const agendaTitle = meetingId ? (meetings.find((m) => m.id === meetingId)?.title ?? null) : null;
  const wide = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-1 text-ui text-muted-foreground">Action items from your meetings. Update them by hand as work moves.</p>
      </div>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="Tasks need internet for now">
          {items?.length ? "You are seeing the last tasks loaded. Changes are paused until you are back online." : "Connect to see and update your tasks."}
        </Notice>
      )}
      {error && !offline && (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        offline ? null : <p className="text-ui text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        !offline && !error && (
          <Panel className="p-6 text-center">
            <ListChecks className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-ui text-muted-foreground">No tasks yet. Open a meeting and use Extract action items.</p>
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
          <div className="space-y-3">
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
                      on ? "bg-accent-soft text-accent" : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {STATUS_FILTER_LABEL[s]}
                    <span className="tabular-nums text-meta">{counts[s]}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
              <div>
                <label className="mb-1 block text-meta font-semibold" htmlFor="filter-owner">
                  Owner
                </label>
                <select id="filter-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={selectCls}>
                  <option value="">Everyone</option>
                  {hasUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
                  {owners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {owner && owner !== UNASSIGNED && !owners.includes(owner) && <option value={owner}>{owner}</option>}
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
            </div>
          </div>

          <div>
            <AgendaButton onClick={() => setAgendaOpen(true)} disabled={shown.length === 0} className="w-full sm:w-auto" />
          </div>

          <Panel aria-label="Tasks">
            <div
              className={cx("hidden gap-3 border-b border-border/70 px-4 py-2 text-meta font-semibold text-muted-foreground lg:grid", wide)}
              aria-hidden
            >
              <span className="pl-9">Task</span>
              <span>Owner</span>
              <span>Due date</span>
              <span>Status</span>
              <span>Source meeting</span>
            </div>
            {shown.length === 0 ? (
              <p className="p-5 text-ui text-muted-foreground">No tasks match these filters.</p>
            ) : (
              <ul className={cx("divide-y divide-border/70", offline && "pointer-events-none opacity-60")}>
                {shown.map((t) => (
                  <TaskItem
                    key={t.id}
                    item={t}
                    today={today}
                    onPatch={(id, p) => void patch(id, p)}
                    onDelete={(id) => void remove(id)}
                    dupOf={dups.get(t.id)}
                    onJump={jumpTo}
                    rev={revs[t.id] ?? 0}
                    wide={wide}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </>
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
