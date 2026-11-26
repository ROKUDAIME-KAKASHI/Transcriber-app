"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, FileText, Loader2, Paperclip, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, GateReason, Notice, Panel, PanelHeader, cx, inputCls } from "./ui";
import { useToast } from "./Toast";
import { useFlag } from "@/lib/flagsClient";
import {
  MAX_REFERENCES, MAX_REFERENCE_BYTES, MAX_REFERENCE_CHARS, appendBackground, referenceKind, type RefPoint,
} from "@/lib/prework";

export interface ReferenceItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  truncated: boolean;
  points: RefPoint[] | null;
  summarizedAt: string | null;
}

async function errorOf(r: Response, fallback: string): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? fallback;
}

function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Pre-work on a saved plan: attach reference files (only their text is kept), summarise one with AI and
 * add the chosen points to the agenda under "Background". Hidden when switched off or not migrated.
 */
export function PreworkSection({
  planId,
  agenda,
  onAgenda,
  offline,
}: {
  planId: string;
  agenda: string;
  onAgenda: (next: string) => void;
  offline: boolean;
}) {
  const on = useFlag("prework");
  const toast = useToast();
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [refs, setRefs] = useState<ReferenceItem[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [summarising, setSummarising] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/references`, { cache: "no-store" });
      if (r.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!r.ok) {
        setError(await errorOf(r, "Couldn't load the reference files."));
        return;
      }
      const list = ((await r.json()) as { references: ReferenceItem[] }).references;
      setRefs(list);
      setPicked((p) => {
        const next = { ...p };
        for (const ref of list) ref.points?.forEach((pt, i) => (next[`${ref.id}:${i}`] ??= pt.verified));
        return next;
      });
    } catch {
      // Offline: the list can't load, adding is gated below.
      setRefs((x) => x ?? []);
    }
  }, [planId]);

  useEffect(() => {
    if (on && !offline) void load();
  }, [on, offline, load]);

  if (!on || unavailable) return null;

  const count = refs?.length ?? 0;
  const full = count >= MAX_REFERENCES;
  const gate = offline ? "You're offline. Reconnect to add or summarise references." : full ? `At most ${MAX_REFERENCES} references per meeting.` : null;

  function upsert(ref: ReferenceItem) {
    setRefs((list) => {
      const cur = list ?? [];
      return cur.some((r) => r.id === ref.id) ? cur.map((r) => (r.id === ref.id ? ref : r)) : [...cur, ref];
    });
    setPicked((p) => {
      const next = { ...p };
      ref.points?.forEach((pt, i) => (next[`${ref.id}:${i}`] = pt.verified));
      return next;
    });
  }

  async function addFile(file: File) {
    setError(null);
    if (!referenceKind(file.name)) return setError("Use a PDF, Word (.docx), .txt or .md file.");
    if (file.size > MAX_REFERENCE_BYTES) return setError("That file is over 4 MB. Use a smaller file or paste the text.");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/references`, { method: "POST", body });
      if (!r.ok) return setError(await errorOf(r, "Couldn't add that file."));
      upsert(((await r.json()) as { reference: ReferenceItem }).reference);
      toast("Reference added", "success");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function addPasted() {
    setError(null);
    setUploading(true);
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: pasteName.trim() || "Pasted notes", text: pasteText }),
      });
      if (!r.ok) return setError(await errorOf(r, "Couldn't add that text."));
      upsert(((await r.json()) as { reference: ReferenceItem }).reference);
      setPasteText("");
      setPasteName("");
      setPasting(false);
      toast("Reference added", "success");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function summarise(ref: ReferenceItem) {
    setError(null);
    setSummarising(ref.id);
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/references/${encodeURIComponent(ref.id)}/summarize`, { method: "POST" });
      if (!r.ok) return setError(await errorOf(r, "Couldn't summarise this reference. Try again."));
      const j = (await r.json()) as { reference: ReferenceItem; partial?: boolean };
      upsert(j.reference);
      if (!j.reference.points?.length) toast("No clear points found in this file", "neutral");
      else if (j.partial) toast("Very long file: the points come from its first part", "neutral");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSummarising(null);
    }
  }

  async function remove(ref: ReferenceItem) {
    setError(null);
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/references/${encodeURIComponent(ref.id)}`, { method: "DELETE" });
      if (!r.ok) return setError(await errorOf(r, "Couldn't delete this reference."));
      setRefs((list) => (list ?? []).filter((x) => x.id !== ref.id));
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    }
  }

  function addToAgenda(ref: ReferenceItem) {
    const chosen = (ref.points ?? []).filter((_, i) => picked[`${ref.id}:${i}`]).map((p) => p.point);
    if (!chosen.length) return toast("Tick the points to add first", "neutral");
    const res = appendBackground(agenda, chosen);
    if (res.added) onAgenda(res.agenda);
    if (res.added && res.skipped) toast(`Added ${res.added}. ${res.skipped} already there or didn't fit`, "success");
    else if (res.added) toast(`Added ${res.added} to the agenda. Save to keep it.`, "success");
    else toast("Those points are already in the agenda", "neutral");
  }

  return (
    <Panel aria-labelledby={`${uid}-h`}>
      <PanelHeader title={<span id={`${uid}-h`}>Pre-work</span>} meta={count ? String(count) : undefined} />
      <div className="space-y-4 p-4">
        <p className="text-meta text-muted-foreground">
          Add reading material, then let the AI pick out short background points for your agenda. Files aren&apos;t stored. Only their text is kept to make the summary.
        </p>

        {error && (
          <div role="alert">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        {refs === null && !offline && (
          <p className="flex items-center gap-2 text-meta text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading
          </p>
        )}

        {refs && refs.length > 0 && (
          <ul className="space-y-3">
            {refs.map((ref) => (
              <li key={ref.id} className="rounded-chip border border-border/70 bg-background p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-ui font-semibold">{ref.fileName}</p>
                    <p className="text-meta text-muted-foreground tabular-nums">{sizeText(ref.sizeBytes)}</p>
                    {ref.truncated && (
                      <p className="text-meta text-warning-text">Text cut at {MAX_REFERENCE_CHARS / 1000}k characters</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(ref)}
                    aria-label={`Delete ${ref.fileName}`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger-text"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <div className="mt-2">
                  <Button
                    variant="secondary"
                    icon={<Sparkles className="h-4 w-4" aria-hidden />}
                    loading={summarising === ref.id}
                    disabled={offline || summarising !== null}
                    onClick={() => void summarise(ref)}
                    aria-describedby={offline ? `${uid}-gate` : undefined}
                  >
                    {ref.points ? "Summarise again" : "Summarise"}
                  </Button>
                  {!ref.points && !offline && (
                    <p className="mt-1.5 text-meta text-muted-foreground">Tapping Summarise sends this file&apos;s text to the AI service.</p>
                  )}
                </div>

                {ref.points && ref.points.length === 0 && (
                  <p className="mt-3 text-meta text-muted-foreground">No clear points found in this file.</p>
                )}
                {ref.points && ref.points.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <ul className="space-y-1">
                      {ref.points.map((pt, i) => {
                        const key = `${ref.id}:${i}`;
                        const cbId = `${uid}-${key}`;
                        return (
                          <li key={key} className="rounded-chip bg-muted/60 px-2">
                            <div className="flex items-start gap-2">
                              <input
                                id={cbId}
                                type="checkbox"
                                checked={!!picked[key]}
                                onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.checked }))}
                                className="mt-3.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                              />
                              <label htmlFor={cbId} className="min-h-11 min-w-0 flex-1 cursor-pointer py-2.5 text-ui">
                                {pt.point}
                                {!pt.verified && (
                                  <span className="ml-2 align-middle">
                                    <Badge tone="warning">Unverified</Badge>
                                  </span>
                                )}
                              </label>
                            </div>
                            {pt.sourceQuote && (
                              <details className="group pb-2 pl-7">
                                <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-accent-text">
                                  Source <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                                </summary>
                                <blockquote className="mt-1 break-words border-l-2 border-border pl-2 text-meta italic text-muted-foreground">
                                  {pt.sourceQuote}
                                </blockquote>
                                {!pt.verified && (
                                  <p className="mt-1 text-meta text-warning-text">This quote wasn&apos;t found word for word in the file. Check it before using.</p>
                                )}
                              </details>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="pt-2">
                      <Button variant="primary" onClick={() => addToAgenda(ref)}>
                        Add to agenda
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {pasting ? (
          <div className="space-y-2 rounded-chip border border-border/70 p-3">
            <label htmlFor={`${uid}-pn`} className="block text-meta font-semibold">
              Name (optional)
            </label>
            <input id={`${uid}-pn`} value={pasteName} maxLength={200} onChange={(e) => setPasteName(e.target.value)} placeholder="Pasted notes" className={inputCls} />
            <label htmlFor={`${uid}-pt`} className="block text-meta font-semibold">
              Text
            </label>
            <textarea
              id={`${uid}-pt`}
              value={pasteText}
              rows={6}
              onChange={(e) => setPasteText(e.target.value)}
              className={cx(inputCls, "min-h-32 py-3")}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={uploading} disabled={offline || !pasteText.trim()} onClick={() => void addPasted()}>
                Add text
              </Button>
              <Button variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a reference file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void addFile(f);
              }}
            />
            <Button
              variant="secondary"
              icon={<Paperclip className="h-4 w-4" aria-hidden />}
              loading={uploading}
              disabled={offline || full}
              onClick={() => fileInput.current?.click()}
              aria-describedby={gate ? `${uid}-gate` : undefined}
            >
              Add reference
            </Button>
            <Button variant="ghost" disabled={offline || full} onClick={() => setPasting(true)} aria-describedby={gate ? `${uid}-gate` : undefined}>
              Paste text
            </Button>
          </div>
        )}
        <GateReason id={`${uid}-gate`} reason={gate} />
        <p className="text-meta text-muted-foreground">PDF, Word (.docx), .txt or .md, up to 4 MB. Scanned PDFs without selectable text can&apos;t be read.</p>
      </div>
    </Panel>
  );
}
