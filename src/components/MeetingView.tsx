"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronLeft, ChevronDown, Pencil, Share2, Sparkles, Trash2, Check, X, Monitor, Smartphone, FileText, FileType,
  FileDown, Copy,
} from "lucide-react";
import { TEMPLATES, formatDuration, speakerLabel, transcriptToText, type TranscriptPart } from "@/lib/transcript";
import * as haptics from "@/lib/haptics";
import { useToast } from "./Toast";
import { SpeakerChip } from "./SpeakerChip";
import { RenameSpeakerSheet } from "./RenameSpeakerSheet";
import { NameSuggestions } from "./NameSuggestions";
import { DEFAULT_SUMMARY_MODEL, SUMMARY_MODELS, type SummaryModel } from "@/lib/aiModels";
import { navBack } from "@/lib/navStack";
import { buildExport } from "@/lib/export";
import {
  ExportError, copyText, copyTextSync, nativeFileShareMissing, nativePdfMissing, preloadExport, shareOrSave, shareText,
  webCanShareFiles,
} from "@/lib/export/deliver";
import { isNative } from "@/lib/native";
import { cacheServerMeeting, setServerDocument, setSpeakerNames, setTitle as setLocalTitle, tombstone } from "@/lib/local/repo";
import { flush, isRecordingId, poke } from "@/lib/local/sync";
import { stopRecordingRemotely } from "@/lib/local/stopRemote";
import { discardNativeAudio } from "@/lib/nativeRecorder";
import { isStaleRecording, stopConfirmText } from "@/lib/recordingState";
import { useLocalUser } from "./SyncProvider";
import { ShareMenu } from "./ShareMenu";
import type { ExportKind, ExportMeeting } from "@/lib/export/types";
import { TranscriptView } from "./TranscriptView";
import { ActionItems } from "./ActionItems";
import { useFeatureGate } from "@/lib/featureGate";
import { Badge, Button, FieldLabel, GateReason, LiveDot, OptionList, Panel, PanelHeader, Segmented, cx, inputCls } from "./ui";

export interface MeetingData {
  id: string;
  title: string;
  status: string;
  language: string;
  durationSec: number;
  deviceName: string | null;
  template: string | null;
  document: string | null;
  createdAt: string;
  updatedAt?: string;
  speakerNames?: Record<string, string> | null;
  transcript: TranscriptPart[];
}

const MODEL_KEY = "transcriber.summaryModel";

export function MeetingView({ meeting, source = "server" }: { meeting: MeetingData; source?: "server" | "local" }) {
  const router = useRouter();
  const toast = useToast();
  const { userId } = useLocalUser();
  const [title, setTitle] = useState(meeting.title);
  const [savedTitle, setSavedTitle] = useState(meeting.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [template, setTemplate] = useState(meeting.template ?? "MOM");
  const [docTemplate, setDocTemplate] = useState(meeting.template ?? "MOM");
  const [doc, setDoc] = useState(meeting.document);
  const [tab, setTab] = useState<"document" | "transcript" | "tasks">(meeting.document ? "document" : "transcript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stoppedHere, setStoppedHere] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportKind | "share" | null>(null);
  const [exportNote, setExportNote] = useState<{ tone: "error"; text: string } | null>(null);
  const preloaded = useRef(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [headerRenaming, setHeaderRenaming] = useState<number | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());

  const [names, setNames] = useState<Record<string, string> | null>(meeting.speakerNames ?? null);
  const rawText = transcriptToText(meeting.transcript, { names });
  const speakerIds = Array.from(new Set(meeting.transcript.map((p) => p.speaker)));
  const speakers = speakerIds.length;
  const words = meeting.transcript.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);

  // AI model for Minutes / Reports; the last choice is remembered on this device.
  const [model, setModel] = useState<SummaryModel>(DEFAULT_SUMMARY_MODEL);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (SUMMARY_MODELS.some((m) => m.value === saved)) setModel(saved as SummaryModel);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);
  const chooseModel = (value: SummaryModel) => {
    setModel(value);
    try {
      localStorage.setItem(MODEL_KEY, value);
    } catch {
      /* ignore */
    }
  };

  // Keep a device copy of what the server has, so the meeting opens without a connection.
  useEffect(() => {
    if (source !== "server" || !userId) return;
    void cacheServerMeeting(userId, { ...meeting, updatedAt: meeting.updatedAt ?? meeting.createdAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, userId, meeting.id]);

  // Names are built from a ref, not the `names` state closure, so several quick renames (or "Use all"
  // on name suggestions) never overwrite each other.
  const namesRef = useRef(names);
  const renameSpeakers = async (updates: Record<number, string>): Promise<boolean> => {
    const prev = namesRef.current;
    const next: Record<string, string> = { ...(prev ?? {}) };
    for (const [k, raw] of Object.entries(updates)) {
      const name = raw.trim().slice(0, 40);
      if (name) next[k] = name;
      else delete next[k];
    }
    namesRef.current = next;
    try {
      if (userId && (await setSpeakerNames(userId, meeting.id, next))) {
        poke(meeting.id);
      } else {
        const res = await fetch(`/api/meetings/${meeting.id}/speakers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerNames: next }),
        });
        if (!res.ok) throw new Error("save failed");
      }
    } catch {
      if (namesRef.current === next) namesRef.current = prev;
      return false;
    }
    setNames(next);
    return true;
  };
  const renameSpeaker = (n: number, raw: string): Promise<boolean> => renameSpeakers({ [n]: raw });

  const saveTitle = async () => {
    setEditingTitle(false);
    setTitleError(null);
    const next = title.trim();
    if (!next || next === savedTitle) return setTitle(savedTitle);
    if (userId && (await setLocalTitle(userId, meeting.id, next))) {
      setSavedTitle(next);
      poke(meeting.id);
      return;
    }
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error("save failed");
      setSavedTitle(next);
      router.refresh();
    } catch {
      setTitle(savedTitle);
      setTitleError("Couldn't rename the meeting. Check your connection and try again.");
    }
  };

  // Phones kill the request when the screen locks, but the server still finishes and saves the
  // document. So after a network failure we poll the meeting until the new document shows up.
  const prevDoc = useRef<string | null>(meeting.document);
  const polling = useRef(false);
  const pollDeadline = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    polling.current = false;
  }, []);

  const checkForResult = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      const m = data?.meeting as { document?: string | null; template?: string | null } | undefined;
      if (m?.document && m.document !== prevDoc.current) {
        setDoc(m.document);
        if (m.template) setDocTemplate(m.template);
        if (userId) void setServerDocument(userId, meeting.id, m.document, m.template ?? template);
        setTab("document");
        setStatus(null);
        setError(null);
        setBusy(false);
        stopPolling();
        return true;
      }
    } catch {
      /* still offline: try again on the next tick */
    }
    return false;
  }, [meeting.id, stopPolling, userId, template]);

  const startPolling = useCallback(() => {
    if (polling.current) return;
    polling.current = true;
    pollDeadline.current = Date.now() + 15 * 60_000; // long meetings are summarised in several steps
    setStatus("Still working… checking for the result");
    pollTimer.current = setInterval(async () => {
      if (await checkForResult()) return;
      if (Date.now() > pollDeadline.current) {
        stopPolling();
        setStatus(null);
        setBusy(false);
        setError("We couldn't get the result. Check your connection and try again.");
      }
    }, 4000);
  }, [checkForResult, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  // Coming back to the app (screen unlocked): look for the result straight away.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && polling.current) void checkForResult();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkForResult]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    prevDoc.current = doc;
    if (userId) {
      // The server summarises what it has, so the whole transcript must be uploaded first.
      setStatus("Uploading the transcript…");
      const r = await flush(meeting.id, { timeoutMs: 20000 });
      setStatus(null);
      if (r === "needs-auth") {
        setError("Sign in again to upload this meeting first.");
        setBusy(false);
        return;
      }
      if (r === "pending" || r === "conflict") {
        setError("Waiting to upload the transcript. Connect to the internet and try again.");
        setBusy(false);
        return;
      }
    }
    let res: Response;
    try {
      res = await fetch(`/api/meetings/${meeting.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, model }),
      });
    } catch {
      // Network error, e.g. "Failed to fetch" / "Load failed" after the screen locked.
      startPolling();
      return;
    }
    const data = (await res.json().catch(() => null)) as { document?: string; error?: string } | null;
    if (res.ok && data?.document) {
      setDoc(data.document);
      setDocTemplate(template);
      if (userId) void setServerDocument(userId, meeting.id, data.document, template);
      setTab("document");
      setBusy(false);
      return;
    }
    if (!data) {
      // Not JSON (gateway page or a cut-off response): the server may still have finished.
      startPolling();
      return;
    }
    setError(
      data.error ||
        (res.status === 504 || res.status === 502
          ? "The AI took too long or the server is busy. Try again, or pick GLM Flash."
          : "Processing failed. Please try again.")
    );
    setBusy(false);
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setConfirmDelete(false);
    setError(null);
    if (userId && (await tombstone(userId, meeting.id))) {
      void discardNativeAudio(meeting.id); // audio an offline recording may still hold on this phone
      poke(meeting.id);
      router.push("/meetings");
      router.refresh();
      return;
    }
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setError("Couldn't delete the meeting. Check your connection and try again.");
      return;
    }
    router.push("/meetings");
    router.refresh();
  };

  const docName = docTemplate === "Report" ? "Report" : "Minutes";
  const showingDoc = tab === "document" && !!doc;
  const currentText = showingDoc ? doc! : rawText;
  const currentName = showingDoc ? docName : "Transcript";

  const exportMeeting: ExportMeeting = { title, transcript: meeting.transcript, document: doc, docName, speakerNames: names };
  const nothingToExport = !doc && meeting.transcript.length === 0;

  const warmExport = () => {
    if (preloaded.current) return;
    preloaded.current = true;
    preloadExport();
  };

  const runExport = async (kind: ExportKind) => {
    setExportNote(null);
    const target = showingDoc ? "document" : "transcript";
    // Old APKs without the native plugins: handled synchronously so the clipboard copy stays
    // inside the tap.
    if (kind === "pdf" && nativePdfMissing()) {
      setExportNote({ tone: "error", text: "Update the app to make PDFs here. Try Word or Text instead." });
      return;
    }
    if (kind !== "pdf" && nativeFileShareMissing()) {
      copyTextSync(currentText);
      setExportNote({ tone: "error", text: "Update the app to share files. The text is copied to your clipboard instead." });
      return;
    }
    setExportBusy(kind);
    try {
      const file = await buildExport({ kind, target, meeting: exportMeeting });
      const result = await shareOrSave(file, title); // "cancelled" and "printed" show no message
      if (result === "ok") {
        toast(kind === "pdf" ? "Saved PDF" : kind === "docx" ? "Saved Word file" : "Saved text file");
        haptics.success();
      }
    } catch (e) {
      console.error("Export failed:", e);
      const code = e instanceof ExportError ? e.code : undefined;
      const text =
        code === "SHARE_FAILED"
          ? "Couldn't open the share sheet. Try Copy text instead."
          : kind === "pdf"
            ? "Couldn't make the PDF. Try Word or Text instead."
            : kind === "docx"
              ? "Couldn't make the Word file. Try PDF or Text instead."
              : "Couldn't save the text file. Try Copy text instead.";
      setExportNote({ tone: "error", text });
    } finally {
      setExportBusy(null);
    }
  };

  const fileKind: ExportKind = isNative() ? (nativePdfMissing() ? "docx" : "pdf") : "docx";

  const runShare = async (target: "document" | "transcript") => {
    setExportNote(null);
    const text = target === "document" ? doc ?? "" : rawText;
    if (nativeFileShareMissing()) {
      copyTextSync(text);
      setExportNote({ tone: "error", text: "Update the app to share files. The text is copied to your clipboard instead." });
      return;
    }
    setExportBusy("share");
    try {
      if (!isNative() && !webCanShareFiles() && typeof navigator.share === "function") {
        const result = await shareText(text, title);
        if (result === "copied") {
          toast("Copied to clipboard");
          haptics.success();
        } else if (result === "ok") {
          toast("Shared");
          haptics.success();
        }
      } else {
        const result = await shareOrSave(await buildExport({ kind: fileKind, target, meeting: exportMeeting }), title);
        if (result === "ok") {
          toast("Shared");
          haptics.success();
        }
      }
    } catch (e) {
      console.error("Share failed:", e);
      const code = e instanceof ExportError ? e.code : undefined;
      let msg = "Couldn't open the share sheet. Try Copy text instead.";
      if (code === "BUILD_FAILED") {
        msg = fileKind === "pdf" ? "Couldn't make the PDF. Try Word or Text instead." : "Couldn't make the Word file. Try PDF or Text instead.";
      }
      setExportNote({ tone: "error", text: msg });
    } finally {
      setExportBusy(null);
    }
  };

  const runCopy = async () => {
    setExportNote(null);
    try {
      await copyText(currentText);
      toast("Copied to clipboard");
      haptics.success();
    } catch (e) {
      console.error("Copy failed:", e);
      setExportNote({ tone: "error", text: "Couldn't copy. Select the text and copy it by hand." });
    }
  };

  const isPhone = /iPhone|iPad|Android/i.test(meeting.deviceName ?? "");
  const DeviceIcon = isPhone ? Smartphone : Monitor;
  const hasTranscript = meeting.transcript.length > 0;
  const aiGate = useFeatureGate("ai");
  const aiReason = aiGate.reason === "Needs internet" ? "Needs internet. We'll keep this meeting ready." : aiGate.reason;

  const deleteButton = (
    <Button
      variant={confirmDelete ? "danger-solid" : "danger"}
      icon={<Trash2 className="h-4 w-4" />}
      onClick={remove}
    >
      {confirmDelete ? "Tap again to delete" : "Delete meeting"}
    </Button>
  );

  const anyBusy = exportBusy !== null;
  const off = (k: ExportKind | "share") => nothingToExport || (anyBusy && exportBusy !== k);

  const docWord = template === "Report" ? "report" : "minutes";

  const aiForm = (
    <div className="space-y-4 p-5">
      <div>
        <FieldLabel>Document</FieldLabel>
        <Segmented
          label="Document type"
          value={template as "MOM" | "Report"}
          onChange={setTemplate}
          disabled={busy}
          options={TEMPLATES.map((t) => ({ value: t.value, label: t.value === "MOM" ? "Minutes" : t.label }))}
        />
      </div>
      <div>
        <FieldLabel>Model</FieldLabel>
        <OptionList
          label="AI model"
          value={model}
          disabled={busy}
          onChange={chooseModel}
          options={SUMMARY_MODELS.map((m) => ({
            value: m.value,
            title: m.label.split(" · ")[1],
            aside: m.label.split(" · ")[0],
            description: m.hint,
          }))}
        />
      </div>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        icon={<Sparkles className="h-4 w-4" />}
        disabled={!hasTranscript || !aiGate.enabled}
        aria-disabled={!hasTranscript || !aiGate.enabled}
        aria-describedby={aiReason ? "ai-gate-reason" : undefined}
        onClick={generate}
      >
        {busy ? (status ?? "Writing… this can take a minute") : doc ? `Regenerate ${docWord}` : `Create ${docWord}`}
      </Button>
      <GateReason id="ai-gate-reason" reason={aiReason} />
      {!hasTranscript && <p className="text-meta text-muted-foreground">This meeting has no transcript to work from.</p>}
      {error && (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      {/* ---------- Header ---------- */}
      <header className="mb-6 sm:mb-8">
        <Link
          href="/meetings"
          aria-label="Back to meetings"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-btn px-2 text-meta font-semibold text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navBack(router, "/meetings");
          }}
        >
          <ChevronLeft className="h-4 w-4" /> Meetings
        </Link>
        <div className="mt-1">
          {editingTitle ? (
            <div className="flex gap-2">
              <input
                autoFocus
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setTitle(savedTitle);
                    setEditingTitle(false);
                  }
                }}
                aria-label="Meeting title"
                className={cx(inputCls, "text-2xl font-semibold sm:text-2xl")}
              />
              <Button onClick={saveTitle} aria-label="Save title" icon={<Check className="h-4 w-4" />} />
              <Button
                onClick={() => {
                  setTitle(savedTitle);
                  setEditingTitle(false);
                }}
                aria-label="Cancel"
                icon={<X className="h-4 w-4" />}
              />
            </div>
          ) : (
            <button onClick={() => setEditingTitle(true)} className="group -mx-1 rounded-chip px-1 text-left" title="Rename">
              <h1 className="break-words text-2xl font-semibold tracking-tight">
                {title}
                <Pencil className="ml-2 inline h-4 w-4 align-middle text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-60" />
              </h1>
            </button>
          )}
        </div>
        {titleError && <p className="mt-2 text-meta text-danger" role="alert">{titleError}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-meta tabular-nums text-muted-foreground">
          <span suppressHydrationWarning>
            {new Date(meeting.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
          <span aria-hidden>·</span>
          <span>{formatDuration(meeting.durationSec)}</span>
          <span aria-hidden>·</span>
          <span>{words.toLocaleString("en-IN")} words</span>
          {meeting.deviceName && (
            <span className="inline-flex items-center gap-1.5 font-sans">
              <DeviceIcon className="h-3.5 w-3.5" /> {meeting.deviceName}
            </span>
          )}
          {meeting.status === "RECORDING" && !stoppedHere && (
            isStaleRecording({ status: meeting.status, serverUpdatedAt: meeting.updatedAt, createdAt: meeting.createdAt }, Date.now()) ? (
              <Badge tone="warning">Not responding</Badge>
            ) : (
              <Badge tone="live">
                <LiveDot /> Still recording on a device
              </Badge>
            )
          )}
          {meeting.status === "RECORDING" && !stoppedHere && !isRecordingId(meeting.id) && (
            <Button
              variant="danger"
              disabled={stopping}
              onClick={async () => {
                if (stopping || !window.confirm(stopConfirmText(meeting.deviceName))) return;
                setStopping(true);
                const r = await stopRecordingRemotely(userId, meeting.id);
                setStopping(false);
                if (r === "finish-here") {
                  toast("Finishing the transcript on this phone");
                  router.push("/");
                } else if (r === "ok") {
                  setStoppedHere(true);
                  toast("Recording stopped");
                  router.refresh();
                } else {
                  toast(r === "auth" ? "Signed out. Sign in again to stop it." : "Couldn't stop it. Check the connection and try again.", "danger");
                }
              }}
            >
              {stopping ? "Stopping…" : "Stop recording"}
            </Button>
          )}
        </div>
        {speakers > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            {speakerIds.map((n) => (
              <span key={n} className="relative">
                <SpeakerChip
                  speaker={n}
                  label={speakerLabel(n, names)}
                  expanded={headerRenaming === n}
                  buttonRef={(el) => {
                    if (el) chipRefs.current.set(n, el);
                    else chipRefs.current.delete(n);
                  }}
                  onClick={() => setHeaderRenaming((cur) => (cur === n ? null : n))}
                />
                {headerRenaming === n && (
                  <RenameSpeakerSheet
                    speaker={n}
                    currentName={names?.[String(n)]}
                    onClose={() => {
                      setHeaderRenaming(null);
                      requestAnimationFrame(() => chipRefs.current.get(n)?.focus());
                    }}
                    onSave={async (name) => {
                      const ok = await renameSpeaker(n, name);
                      if (ok) {
                        setHeaderRenaming(null);
                        requestAnimationFrame(() => chipRefs.current.get(n)?.focus());
                      }
                      return ok;
                    }}
                  />
                )}
              </span>
            ))}
          </div>
        )}
        <NameSuggestions
          meetingId={meeting.id}
          parts={meeting.transcript}
          names={names}
          enabled={meeting.status === "DONE"}
          onRename={renameSpeaker}
          onRenameMany={renameSpeakers}
        />
      </header>

      {/* ---------- Actions ---------- */}
      <section aria-label="Export" onPointerEnter={warmExport} onFocus={warmExport} className="mb-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full lg:w-auto lg:min-w-[200px]">
            <Button
              ref={shareBtnRef}
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                preloadExport();
                setShareOpen((o) => !o);
              }}
              loading={exportBusy === "share"}
              disabled={off("share")}
              aria-haspopup="menu"
              aria-expanded={shareOpen}
              icon={<Share2 className="h-4 w-4" />}
            >
              {exportBusy === "share" ? "Preparing…" : "Share"}
            </Button>
            <ShareMenu
              open={shareOpen}
              onClose={() => setShareOpen(false)}
              anchorRef={shareBtnRef}
              docLabel={doc ? (docTemplate === "Report" ? "report" : "minutes") : null}
              fileDescription={fileKind === "pdf" ? "PDF file" : "Word file"}
              hasTranscript={hasTranscript}
              copyDescription={showingDoc ? `Copies the ${docName.toLowerCase()}` : "Copies the transcript"}
              canCopy={currentText.trim().length > 0}
              onShareDocument={() => runShare("document")}
              onShareTranscript={() => runShare("transcript")}
              onCopy={runCopy}
            />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="w-full rounded-full lg:w-auto"
            icon={<Copy className="h-4 w-4" />}
            disabled={currentText.trim().length === 0}
            onClick={runCopy}
          >
            Copy
          </Button>
        </div>
        <p className="mb-2 mt-4 text-meta font-semibold text-muted-foreground">More formats</p>
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => runExport("pdf")} loading={exportBusy === "pdf"} disabled={off("pdf")} icon={<FileDown className="h-4 w-4" />} className="min-h-11 px-2">
            PDF
          </Button>
          <Button onClick={() => runExport("docx")} loading={exportBusy === "docx"} disabled={off("docx")} icon={<FileType className="h-4 w-4" />} className="min-h-11 px-2">
            Word
          </Button>
          <Button onClick={() => runExport("txt")} loading={exportBusy === "txt"} disabled={off("txt")} icon={<FileText className="h-4 w-4" />} className="min-h-11 px-2">
            Text
          </Button>
        </div>
        {nothingToExport && <p className="mt-2 text-meta text-muted-foreground">This meeting has nothing to export yet.</p>}
        {exportNote && <p className="mt-2 text-meta text-danger" role="alert">{exportNote.text}</p>}
      </section>

      {/* ---------- Tabs ---------- */}
      <Segmented
        semantics="tabs"
        label="Meeting content"
        value={tab}
        onChange={(t) => {
          setTab(t);
          haptics.tap();
        }}
        options={[
          { value: "document", label: docName, id: "meeting-tab-document", controls: "meeting-tabpanel" },
          { value: "transcript", label: "Transcript", id: "meeting-tab-transcript", controls: "meeting-tabpanel" },
          { value: "tasks", label: "Action items", id: "meeting-tab-tasks", controls: "meeting-tabpanel" },
        ]}
        className="mb-4 max-w-[480px]"
      />

      <div key={tab} id="meeting-tabpanel" role="tabpanel" aria-labelledby={`meeting-tab-${tab}`} className="text-in space-y-4">
        {tab === "document" ? (
          doc ? (
            <>
              <Panel className="px-5 py-6 sm:px-8 sm:py-8">
                <article className="prose prose-stone max-w-[72ch] text-reading sm:text-base dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h1:mb-3 prose-h1:mt-10 prose-h1:text-2xl first:prose-h1:mt-0 prose-h2:text-base prose-p:leading-[1.6] prose-li:my-1 prose-table:text-meta prose-th:bg-muted/60 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 [&_table]:block [&_table]:overflow-x-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{doc}</Markdown>
                </article>
              </Panel>
              <Panel aria-label="AI document">
                <button
                  type="button"
                  aria-expanded={regenOpen}
                  onClick={() => setRegenOpen((o) => !o)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-panel px-5 text-left text-ui font-semibold"
                >
                  Regenerate with AI
                  <ChevronDown className={cx("h-4 w-4 transition-transform duration-[var(--dur-2)]", regenOpen && "rotate-180")} aria-hidden />
                </button>
                {regenOpen && <div className="border-t border-border/70">{aiForm}</div>}
              </Panel>
            </>
          ) : (
            <Panel aria-label="AI document">
              <PanelHeader title="Create with AI" />
              {aiForm}
            </Panel>
          )
        ) : tab === "tasks" ? (
          <ActionItems meetingId={meeting.id} meetingTitle={meeting.title} parts={meeting.transcript} names={names} hasTranscript={hasTranscript} />
        ) : (
          <Panel className="px-5 py-6 sm:px-8 sm:py-8">
            {hasTranscript ? (
              <TranscriptView parts={meeting.transcript} window="head" speakerNames={names} onRenameSpeaker={renameSpeaker} renameHint />
            ) : (
              <p className="text-ui text-muted-foreground">No transcript was captured.</p>
            )}
          </Panel>
        )}
      </div>

      <div className="mt-8 flex justify-center border-t border-border pt-6">{deleteButton}</div>
    </div>
  );
}
