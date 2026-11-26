"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Trash2, X } from "lucide-react";
import { PersonPicker } from "./PersonPicker";
import { Badge, Button, FieldLabel, cx, selectCls } from "./ui";
import { pushOverlay } from "@/lib/overlays";
import { STATUSES, STATUS_LABEL, type TaskRow, type TaskStatus } from "@/lib/taskTracker";
import { dueView } from "@/lib/taskView";
import { localToday, maxDeadline, validateDeadline } from "@/lib/deadline";
import { HISTORY_PAGE, describeEvent, type HistoryEvent } from "@/lib/taskHistory";

export type Patch = Partial<Pick<TaskRow, "status" | "owner" | "ownerStakeholderId" | "dueDate" | "note" | "task">>;

export const STATUS_TONE: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-muted text-foreground",
  IN_PROGRESS: "bg-accent-soft text-accent-text",
  BLOCKED: "bg-danger-soft text-danger-text",
  DONE: "bg-success-soft text-success-text",
};

export const fieldCls =
  "min-h-11 w-full rounded-chip border border-transparent bg-muted px-3 text-base outline-none transition-[box-shadow,background-color] duration-[var(--dur-2)] placeholder:text-muted-foreground focus:ring-2 focus:ring-accent sm:text-ui lg:min-h-10";

export function formatDue(day: string): string {
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

/**
 * The detail of one task: a right-hand panel on laptops, a bottom sheet on phones. Esc, the Android back key and the
 * backdrop close it; Tab stays inside; focus goes back to whatever opened it.
 */
export function TaskDetail({
  item, today, offline, rev, dupOf, onPatch, onDelete, onClose, onSeries, onJump,
}: {
  item: TaskRow;
  today: string;
  offline: boolean;
  rev: number;
  dupOf?: string;
  onPatch: (id: string, p: Patch) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onSeries: (id: string) => void;
  onJump: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const [shown, setShown] = useState(false);
  const [title, setTitle] = useState(item.task);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dueErr, setDueErr] = useState<string | null>(null);
  useEffect(() => setDueErr(null), [item.id]);
  useEffect(() => setTitle(item.task), [item.task]);
  useEffect(() => setOwner(item.owner ?? ""), [item.owner]);
  useEffect(() => setNote(item.note ?? ""), [item.note]);
  useEffect(() => setConfirmDelete(false), [item.id]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      setShown(true);
      ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    });
    const unregister = pushOverlay(() => closeRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]"));
      if (f.length === 0) return;
      const a = document.activeElement;
      if (e.shiftKey && (a === f[0] || !ref.current.contains(a))) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (a === f[f.length - 1] || !ref.current.contains(a))) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      unregister();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const due = dueView(item, today);
  const saveTitle = () => {
    const next = title.trim();
    if (!next) return setTitle(item.task);
    if (next !== item.task) onPatch(item.id, { task: next });
  };
  const saveOwner = () => {
    const next = owner.trim();
    if (next !== (item.owner ?? "")) onPatch(item.id, { owner: next || null });
  };
  const saveNote = () => {
    const next = note.trim();
    if (next !== (item.note ?? "")) onPatch(item.id, { note: next || null });
  };
  const id = item.id;

  return (
    <>
      <div
        className={cx("fixed inset-0 z-30 bg-black/40 transition-opacity duration-[var(--dur-2)]", shown ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        className={cx(
          "safe-bottom fixed inset-x-0 bottom-0 z-40 flex max-h-[90dvh] flex-col rounded-t-modal border border-border/70 bg-card shadow-float",
          "transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-in-out)]",
          "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[28rem] lg:rounded-none lg:rounded-l-modal lg:border-r-0",
          shown ? "translate-y-0 opacity-100 lg:translate-x-0" : "translate-y-full opacity-0 lg:translate-x-full lg:translate-y-0"
        )}
      >
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/70 px-4">
          <h2 className="text-ui font-semibold">Task</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground lg:h-9 lg:w-9"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <fieldset disabled={offline} className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4 pb-8">
          {offline && <p className="text-meta text-warning-text">Offline. Changes are paused until you are back online.</p>}
          <div>
            <FieldLabel htmlFor={`d-title-${id}`}>Title</FieldLabel>
            <textarea
              id={`d-title-${id}`}
              data-autofocus
              rows={2}
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className={cx(fieldCls, "resize-none py-2 font-semibold")}
            />
            {dupOf && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onJump(dupOf);
                }}
                className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-chip bg-warning-soft px-2 text-meta font-semibold text-warning-text hover:opacity-90"
              >
                <Copy className="h-3 w-3" aria-hidden /> Possible duplicate. Show the other
              </button>
            )}
          </div>

          <div className="grid gap-3 min-[420px]:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor={`d-status-${id}`}>Status</FieldLabel>
              <select
                id={`d-status-${id}`}
                value={item.status}
                onChange={(e) => onPatch(id, { status: e.target.value as TaskStatus })}
                className={cx(selectCls, "!min-h-11 !rounded-full !border-transparent text-ui font-semibold lg:!min-h-10", STATUS_TONE[item.status])}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`d-due-${id}`}>Due date</FieldLabel>
              <input
                id={`d-due-${id}`}
                type="date"
                value={due.day}
                min={localToday()}
                max={maxDeadline()}
                aria-invalid={!!dueErr}
                aria-describedby={dueErr ? `d-due-err-${id}` : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  const err = validateDeadline(v, { previous: due.day });
                  setDueErr(err);
                  if (!err) onPatch(id, { dueDate: v ? `${v}T00:00:00.000Z` : null });
                }}
                className={cx(fieldCls, "num")}
              />
              {dueErr && (
                <p id={`d-due-err-${id}`} className="mt-1 text-meta text-danger-text" role="alert">
                  {dueErr}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 empty:hidden">
                {due.overdue && (
                  <Badge tone="danger">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> Overdue
                  </Badge>
                )}
                {due.said && <span className="text-meta text-muted-foreground">Said: {due.said}</span>}
              </div>
            </div>
          </div>

          <div title={item.ownerDesignation ? `${item.owner} · ${item.ownerDesignation}` : undefined}>
            <FieldLabel htmlFor={`d-owner-${id}`}>Owner</FieldLabel>
            <PersonPicker
              id={`d-owner-${id}`}
              maxLength={100}
              value={owner}
              placeholder="Unassigned"
              onChange={setOwner}
              onCommit={(name, personId) => {
                // A picked person links the task to People as well as naming the owner.
                if (name !== (item.owner ?? "") || (personId ?? null) !== (item.ownerStakeholderId ?? null)) {
                  onPatch(id, { owner: name || null, ownerStakeholderId: personId ?? null });
                }
              }}
              onBlur={saveOwner}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={fieldCls}
            />
            {item.ownerStakeholderId && (
              <p className="mt-1 break-words text-meta text-muted-foreground">
                {item.ownerDesignation ? `${item.ownerDesignation} · ` : ""}from People
              </p>
            )}
          </div>

          <div>
            <FieldLabel htmlFor={`d-note-${id}`}>Progress note</FieldLabel>
            <textarea
              id={`d-note-${id}`}
              rows={3}
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

          <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <span>From</span>
            <Link
              href={`/meeting?id=${encodeURIComponent(item.meeting.id)}`}
              className="min-w-0 break-words font-semibold text-accent-text underline-offset-2 hover:underline"
            >
              {item.meeting.title}
            </Link>
            <span className="num">{new Date(item.meeting.createdAt).toLocaleDateString()}</span>
            {item.series && (
              <button
                type="button"
                onClick={() => {
                  onSeries(item.series!.id);
                  onClose();
                }}
                aria-label={`Show tasks from the series ${item.series.title}`}
                className="inline-flex h-6 max-w-full items-center rounded-full bg-accent-soft px-2 text-meta font-semibold text-accent-text hover:opacity-90"
              >
                <span className="truncate">{item.series.title}</span>
              </button>
            )}
          </div>

          <TaskHistory id={id} rev={rev} />

          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            {confirmDelete ? (
              <>
                <p className="w-full text-meta text-muted-foreground">Delete this task? You can&rsquo;t undo this.</p>
                <Button variant="danger-solid" onClick={() => onDelete(id)}>
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
        </fieldset>
      </div>
    </>
  );
}
