"use client";

import { PersonPicker } from "./PersonPicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ListChecks, Plus, Trash2, X } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import type { SpeakerNames, TranscriptPart } from "@/lib/transcript";
import Link from "next/link";
import { STATUS_LABEL, type TaskStatus } from "@/lib/taskTracker";
import { splitLongPhrases } from "@/lib/actionItems";
import { matchTask } from "@/lib/dedupe";
import { useToast } from "./Toast";
import { AgendaButton, FollowUpAgendaSheet } from "./FollowUpAgenda";
import { PlanNextButton } from "./PlanNextButton";
import type { AgendaItem } from "@/lib/followUpAgenda";
import { Badge, Button, GateReason, Panel, PanelHeader, cx, inputCls } from "./ui";

interface SavedItem {
  id: string;
  task: string;
  owner: string | null;
  deadlineText: string | null;
  sourceQuote: string;
  status?: TaskStatus;
}

interface Row {
  key: number;
  checked: boolean;
  task: string;
  owner: string;
  /** Set when the owner was picked from People; typing free text clears it. */
  ownerId: string | null;
  deadline: string;
  quote: string;
  verified: boolean;
}

const STATUS_TONE = { NOT_STARTED: "neutral", IN_PROGRESS: "accent", BLOCKED: "danger", DONE: "success" } as const;

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

/** Extract action items with AI, review and edit them, then save the approved ones. */
export function ActionItems({
  meetingId,
  parts,
  names,
  hasTranscript,
  meetingTitle,
  seed,
  onSaved,
}: {
  /** Items found together with the minutes. They fill the review list; nothing is saved until the user approves. */
  seed?: { task: string; owner: string | null; deadlineText: string | null; sourceQuote: string; verified: boolean }[] | null;
  /** Called after the user saved the reviewed items (so the seed is not offered again). */
  onSaved?: () => void;
  meetingId: string;
  meetingTitle?: string;
  parts: TranscriptPart[];
  names: SpeakerNames;
  hasTranscript: boolean;
}) {
  const toast = useToast();
  const aiGate = useFeatureGate("ai");
  const [saved, setSaved] = useState<SavedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(0);
  const savedTasks = useMemo(() => (saved ?? []).map((s) => s.task), [saved]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[] | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);

  // Fresh status and due dates come from the tracker endpoint, not the saved list on screen.
  const openAgenda = async () => {
    setAgendaError(null);
    setAgendaLoading(true);
    try {
      const res = await fetch(`/api/action-items?meetingId=${encodeURIComponent(meetingId)}&status=all`, { cache: "no-store" });
      if (!res.ok) {
        setAgendaError(await readError(res, "Couldn't load the tasks. Try again."));
        return;
      }
      setAgendaItems(((await res.json()) as { items: AgendaItem[] }).items);
    } catch {
      setAgendaError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setAgendaLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/action-items`, { cache: "no-store" });
      if (!res.ok) {
        // 404 just means a meeting that hasn't reached the server yet: nothing saved.
        setLoadError(res.status === 404 ? null : await readError(res, "Couldn't load saved tasks."));
        setSaved([]);
        return;
      }
      setLoadError(null);
      setSaved(((await res.json()) as { items: SavedItem[] }).items);
    } catch {
      setLoadError("Couldn't load saved tasks.");
      setSaved([]);
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Items that came with the minutes appear for review once the saved list is known (so duplicates start unchecked).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !seed || saved === null || rows !== null) return;
    seeded.current = true;
    setRows(
      seed.map((i) => ({
        key: keyRef.current++,
        checked: matchTask(i.task, savedTasks)?.kind !== "same",
        task: i.task,
        owner: i.owner ?? "",
        ownerId: null,
        deadline: i.deadlineText ?? "",
        quote: i.sourceQuote,
        verified: i.verified,
      }))
    );
  }, [seed, saved, rows, savedTasks]);

  const extract = async () => {
    setError(null);
    setExtracting(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/action-items/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server reads its own copy; this is only used when that copy is still empty.
        body: JSON.stringify({ transcript: parts.length <= 20_000 ? splitLongPhrases(parts) : undefined, speakerNames: names ?? null }),
      });
      if (!res.ok) {
        setError(await readError(res, "Couldn't extract action items. Try again."));
        return;
      }
      const data = (await res.json()) as {
        items: { task: string; owner: string | null; deadlineText: string | null; sourceQuote: string; verified: boolean }[];
        truncated?: boolean;
      };
      setTruncated(!!data.truncated);
      setRows(
        data.items.map((i) => ({
          key: keyRef.current++,
          // Something already saved for this meeting starts unchecked, so saving again can't repeat it.
          checked: matchTask(i.task, savedTasks)?.kind !== "same",
          task: i.task,
          owner: i.owner ?? "",
          ownerId: null,
          deadline: i.deadlineText ?? "",
          quote: i.sourceQuote,
          verified: i.verified,
        }))
      );
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setExtracting(false);
    }
  };

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => rs && rs.filter((r) => r.key !== key));
  const add = () =>
    setRows((rs) => [
      ...(rs ?? []),
      { key: keyRef.current++, checked: true, task: "", owner: "", ownerId: null, deadline: "", quote: "", verified: true },
    ]);

  const approved = (rows ?? []).filter((r) => r.checked && r.task.trim());

  const save = async () => {
    if (!approved.length || saving) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: approved.map((r) => ({
            task: r.task.trim().slice(0, 300),
            owner: r.owner.trim() || null,
            ownerStakeholderId: r.owner.trim() ? r.ownerId : null,
            deadlineText: r.deadline.trim() || null,
            sourceQuote: r.quote,
          })),
        }),
      });
      if (!res.ok) {
        setError(await readError(res, "Couldn't save the tasks. Try again."));
        return;
      }
      const data = (await res.json()) as { items: SavedItem[]; saved: number; skipped?: number };
      setSaved(data.items);
      setRows(null);
      onSaved?.();
      const n = `${data.saved} ${data.saved === 1 ? "task" : "tasks"}`;
      toast(data.skipped ? `Saved ${n} · ${data.skipped} ${data.skipped === 1 ? "duplicate" : "duplicates"} skipped` : `Saved ${n}`, "success");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSaved = async (id: string) => {
    const before = saved;
    setSaved((s) => s && s.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("delete failed");
    } catch {
      setSaved(before);
      toast("Couldn't delete the task. Try again.", "danger");
    }
  };

  const gateReason = !aiGate.enabled ? aiGate.reason : null;
  const quoteWarn = (
    <span className="inline-flex items-center gap-1 text-meta text-warning">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Quote not found in transcript
    </span>
  );

  return (
    <div className="space-y-4">
      <Panel aria-label="Extract action items">
        <PanelHeader title="Action items" />
        <div className="space-y-3 p-5">
          <p className="text-ui text-muted-foreground">
            Find the tasks people committed to in this meeting. You review and edit them before anything is saved.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full sm:w-auto"
            loading={extracting}
            icon={<ListChecks className="h-4 w-4" aria-hidden />}
            disabled={!hasTranscript || !aiGate.enabled}
            aria-describedby={gateReason ? "action-items-gate" : undefined}
            onClick={() => void extract()}
          >
            {extracting ? "Extracting…" : rows ? "Extract again" : "Extract action items"}
          </Button>
          <GateReason id="action-items-gate" reason={gateReason} />
          {!hasTranscript && <p className="text-meta text-muted-foreground">This meeting has no transcript to work from.</p>}
          {error && (
            <p className="text-meta text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </Panel>

      {rows && (
        <Panel aria-label="Review action items">
          <PanelHeader title="Review" meta={`${approved.length} of ${rows.length} selected`} />
          <div className="space-y-3 p-5">
            {truncated && (
              <p className="text-meta text-muted-foreground">
                This meeting is very long, so only the first part was checked.
              </p>
            )}
            {rows.length === 0 && (
              <p className="text-ui text-muted-foreground">No clear action items found in this meeting.</p>
            )}
            {rows.length > 0 && (
              <div
                className="hidden grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 px-1 text-meta font-semibold text-muted-foreground md:grid"
                aria-hidden
              >
                <span />
                <span>Task</span>
                <span>Owner</span>
                <span>Deadline</span>
                <span />
              </div>
            )}
            <ul className="space-y-3">
              {rows.map((r, n) => {
                const dup = matchTask(r.task, savedTasks)?.kind ?? null;
                return (
                <li
                  key={r.key}
                  className={cx(
                    "rounded-chip border border-border/70 bg-muted/30 p-3 transition-opacity",
                    !r.checked && "opacity-60"
                  )}
                >
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_2.75rem] items-start gap-2 md:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem]">
                    <label className="flex min-h-11 items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[var(--accent)]"
                        checked={r.checked}
                        onChange={(e) => update(r.key, { checked: e.target.checked })}
                        aria-label={`Approve task ${n + 1}`}
                      />
                    </label>
                    <div className="min-w-0 md:contents">
                      <div className="min-w-0">
                        <label className="mb-1 block text-meta font-semibold text-muted-foreground md:sr-only" htmlFor={`ai-task-${r.key}`}>
                          Task
                        </label>
                        <textarea
                          id={`ai-task-${r.key}`}
                          rows={2}
                          maxLength={300}
                          value={r.task}
                          onChange={(e) => update(r.key, { task: e.target.value })}
                          className={cx(inputCls, "min-h-11 resize-y py-2")}
                          placeholder="What needs to be done"
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:contents">
                        <div className="min-w-0">
                          <label className="mb-1 block text-meta font-semibold text-muted-foreground md:sr-only" htmlFor={`ai-owner-${r.key}`}>
                            Owner
                          </label>
                          <PersonPicker
                            id={`ai-owner-${r.key}`}
                            maxLength={100}
                            value={r.owner}
                            onChange={(v) => update(r.key, { owner: v, ownerId: null })}
                            onCommit={(name, personId) => update(r.key, { owner: name, ownerId: personId ?? null })}
                            className={inputCls}
                            placeholder="Unassigned"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="mb-1 block text-meta font-semibold text-muted-foreground md:sr-only" htmlFor={`ai-deadline-${r.key}`}>
                            Deadline
                          </label>
                          <input
                            id={`ai-deadline-${r.key}`}
                            maxLength={100}
                            value={r.deadline}
                            onChange={(e) => update(r.key, { deadline: e.target.value })}
                            className={inputCls}
                            placeholder="Not specified"
                          />
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="!min-h-11 !min-w-11 px-0 md:col-start-5 md:row-start-1"
                      onClick={() => remove(r.key)}
                      aria-label={`Remove task ${n + 1}`}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {dup && (
                    <div className="mt-2 pl-10">
                      <Badge tone={dup === "same" ? "neutral" : "warning"}>{dup === "same" ? "Already saved" : "Possible duplicate"}</Badge>
                    </div>
                  )}
                  {(r.quote || !r.verified) && (
                    <div className="mt-2 space-y-1 pl-10">
                      {r.quote && (
                        <p className="text-meta text-muted-foreground">
                          <span className="font-semibold">Source: </span>&ldquo;{r.quote}&rdquo;
                        </p>
                      )}
                      {!r.verified && r.quote && quoteWarn}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={add} className="sm:w-auto">
                Add row
              </Button>
              <Button
                variant="primary"
                loading={saving}
                disabled={!approved.length}
                onClick={() => void save()}
                className="sm:ml-auto"
              >
                Save approved tasks
              </Button>
            </div>
          </div>
        </Panel>
      )}

      <Panel aria-label="Saved tasks">
        <PanelHeader title="Saved tasks" meta={saved && saved.length ? String(saved.length) : undefined}>
          {saved && saved.length > 0 && (
            <Link href={`/tasks?meetingId=${encodeURIComponent(meetingId)}&status=all`} className="text-meta font-semibold text-accent underline-offset-2 hover:underline">
              View in Tasks
            </Link>
          )}
        </PanelHeader>
        <div className="p-5">
          {saved && saved.length > 0 && (
            <div className="mb-4 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <AgendaButton
                  onClick={() => void openAgenda()}
                  loading={agendaLoading}
                  disabled={!!loadError}
                  className="w-full sm:w-auto"
                />
                <PlanNextButton meetingId={meetingId} className="w-full sm:w-auto" />
              </div>
              {agendaError && (
                <p className="text-meta text-danger" role="alert">
                  {agendaError}
                </p>
              )}
            </div>
          )}
          {saved === null ? (
            <p className="text-ui text-muted-foreground">Loading…</p>
          ) : loadError ? (
            <p className="text-meta text-danger" role="alert">
              {loadError}
            </p>
          ) : saved.length === 0 ? (
            <p className="text-ui text-muted-foreground">No saved tasks yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {saved.map((i) => (
                <li key={i.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-ui font-semibold">{i.task}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                      <Badge tone={i.owner ? "accent" : "neutral"}>{i.owner ?? "Unassigned"}</Badge>
                      <Badge tone={STATUS_TONE[i.status ?? "NOT_STARTED"]}>{STATUS_LABEL[i.status ?? "NOT_STARTED"]}</Badge>
                      <span>{i.deadlineText ?? "No deadline"}</span>
                    </p>
                    {i.sourceQuote && (
                      <p className="break-words text-meta text-muted-foreground">&ldquo;{i.sourceQuote}&rdquo;</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    className="!min-h-11 !min-w-11 px-0 text-danger"
                    onClick={() => void deleteSaved(i.id)}
                    aria-label={`Delete task: ${i.task}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <FollowUpAgendaSheet
        open={agendaItems !== null}
        onClose={() => setAgendaItems(null)}
        items={agendaItems ?? []}
        meetingTitle={meetingTitle ?? null}
        meetingId={meetingId}
      />
    </div>
  );
}
