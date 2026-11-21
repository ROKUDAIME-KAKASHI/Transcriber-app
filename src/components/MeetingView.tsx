"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Pencil, Share2, Sparkles, Trash2, Check, X, Calendar, Clock, Monitor, Smartphone, FileText, FileType,
  FileDown, Users,
} from "lucide-react";
import { TEMPLATES, formatDuration, transcriptToText, type TranscriptPart } from "@/lib/transcript";
import { DEFAULT_SUMMARY_MODEL, SUMMARY_MODELS, type SummaryModel } from "@/lib/aiModels";
import { navBack } from "@/lib/navStack";
import { buildExport } from "@/lib/export";
import {
  ExportError, copyText, copyTextSync, nativeFileShareMissing, nativePdfMissing, preloadExport, shareOrSave, shareText,
  webCanShareFiles,
} from "@/lib/export/deliver";
import { isNative } from "@/lib/native";
import { cacheServerMeeting, setServerDocument, setTitle as setLocalTitle, tombstone } from "@/lib/local/repo";
import { flush, poke } from "@/lib/local/sync";
import { useLocalUser } from "./SyncProvider";
import { ShareMenu } from "./ShareMenu";
import type { ExportKind, ExportMeeting } from "@/lib/export/types";
import { TranscriptView } from "./TranscriptView";
import { Badge, Button, FieldLabel, LiveDot, OptionList, Panel, PanelHeader, Segmented, cx, inputCls } from "./ui";

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
  transcript: TranscriptPart[];
}

const MODEL_KEY = "transcriber.summaryModel";

export function MeetingView({ meeting, source = "server" }: { meeting: MeetingData; source?: "server" | "local" }) {
  const router = useRouter();
  const { userId } = useLocalUser();
  const [title, setTitle] = useState(meeting.title);
  const [savedTitle, setSavedTitle] = useState(meeting.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [template, setTemplate] = useState(meeting.template ?? "MOM");
  const [docTemplate, setDocTemplate] = useState(meeting.template ?? "MOM");
  const [doc, setDoc] = useState(meeting.document);
  const [tab, setTab] = useState<"document" | "transcript">(meeting.document ? "document" : "transcript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportKind | "share" | null>(null);
  const [exportNote, setExportNote] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const preloaded = useRef(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const rawText = transcriptToText(meeting.transcript);
  const speakers = new Set(meeting.transcript.map((p) => p.speaker)).size;
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

  const exportMeeting: ExportMeeting = { title, transcript: meeting.transcript, document: doc, docName };
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
      await shareOrSave(file, title); // "cancelled" and "printed" show no message
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
        if ((await shareText(text, title)) === "copied") {
          setExportNote({ tone: "success", text: "Copied to clipboard" });
        }
      } else {
        await shareOrSave(await buildExport({ kind: fileKind, target, meeting: exportMeeting }), title);
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

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const runCopy = async () => {
    setExportNote(null);
    try {
      await copyText(currentText);
      setExportNote({ tone: "success", text: "Copied to clipboard" });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setExportNote(null), 2500);
    } catch (e) {
      console.error("Copy failed:", e);
      setExportNote({ tone: "error", text: "Couldn't copy. Select the text and copy it by hand." });
    }
  };

  const isPhone = /iPhone|iPad|Android/i.test(meeting.deviceName ?? "");
  const DeviceIcon = isPhone ? Smartphone : Monitor;
  const hasTranscript = meeting.transcript.length > 0;

  const deleteButton = (
    <Button
      variant={confirmDelete ? "danger-solid" : "danger"}
      className="w-full"
      icon={<Trash2 className="h-4 w-4" />}
      onClick={remove}
    >
      {confirmDelete ? "Tap again to delete" : "Delete meeting"}
    </Button>
  );

  const exportPanel = (
    <Panel className="p-5" aria-label="Export" onPointerEnter={warmExport} onFocus={warmExport}>
      <ExportButtons
        name={currentName}
        busy={exportBusy}
        disabled={nothingToExport}
        onShare={() => {
          preloadExport();
          setShareOpen((o) => !o);
        }}
        shareRef={shareBtnRef}
        shareOpen={shareOpen}
        menu={
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
        }
        onTxt={() => runExport("txt")}
        onWord={() => runExport("docx")}
        onPdf={() => runExport("pdf")}
      />
      {nothingToExport && <p className="mt-2 text-meta text-muted-foreground">This meeting has nothing to export yet.</p>}
      {exportNote &&
        (exportNote.tone === "error" ? (
          <p className="mt-2 text-meta text-danger" role="alert">{exportNote.text}</p>
        ) : (
          <p className="mt-2 text-meta text-success" role="status">{exportNote.text}</p>
        ))}
      <div className="mt-4 border-t border-border pt-4">{deleteButton}</div>
    </Panel>
  );

  const docWord = template === "Report" ? "report" : "minutes";

  return (
    <div>
      {/* ---------- Header ---------- */}
      <header className="mb-6 sm:mb-8">
        <Link
          href="/meetings"
          aria-label="Back to meetings"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-meta font-semibold text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navBack(router, "/meetings");
          }}
        >
          <ArrowLeft className="h-4 w-4" /> Meetings
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
                className={cx(inputCls, "text-xl font-semibold sm:text-xl")}
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
            <button onClick={() => setEditingTitle(true)} className="group -mx-1 rounded-lg px-1 text-left" title="Rename">
              <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-tight">
                {title}
                <Pencil className="ml-2 inline h-4 w-4 align-middle text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-60" />
              </h1>
            </button>
          )}
        </div>
        {titleError && <p className="mt-2 text-meta text-danger" role="alert">{titleError}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
            <Calendar className="h-3.5 w-3.5" />
            {new Date(meeting.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock className="h-3.5 w-3.5" /> {formatDuration(meeting.durationSec)}
          </span>
          <span className="tabular-nums">{words.toLocaleString("en-IN")} words</span>
          {speakers > 1 && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> {speakers} speakers
            </span>
          )}
          {meeting.deviceName && (
            <span className="inline-flex items-center gap-1.5">
              <DeviceIcon className="h-3.5 w-3.5" /> {meeting.deviceName}
            </span>
          )}
          {meeting.status === "RECORDING" && (
            <Badge tone="live">
              <LiveDot /> Still recording on a device
            </Badge>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
        {/* ---------- Document / transcript ---------- */}
        <div className={cx("min-w-0", doc ? "order-1" : "order-2 lg:order-1")}>
          <div className="mb-4 flex gap-6 border-b border-border" role="tablist">
            {(["document", "transcript"] as const).map((t) => {
              const on = tab === t;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t)}
                  disabled={t === "document" && !doc}
                  className={cx(
                    "-mb-px min-h-11 border-b-2 text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    on ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "document" ? docName : "Transcript"}
                </button>
              );
            })}
          </div>

          <Panel className="px-5 py-6 sm:px-8 sm:py-8">
            <div>
              {showingDoc ? (
                <article className="prose prose-stone max-w-[72ch] dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h1:mb-3 prose-h1:mt-10 prose-h1:text-lg first:prose-h1:mt-0 prose-h2:text-base prose-p:leading-7 prose-li:my-1 prose-table:text-meta prose-th:bg-muted/60 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 [&_table]:block [&_table]:overflow-x-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{doc!}</Markdown>
                </article>
              ) : hasTranscript ? (
                <TranscriptView parts={meeting.transcript} window="head" />
              ) : (
                <p className="text-ui text-muted-foreground">No transcript was captured.</p>
              )}
            </div>
          </Panel>
        </div>

        {/* ---------- Side panel ---------- */}
        {/* Phones: with a document, read it first; without one, the AI panel leads. */}
        <aside className={cx("space-y-4 lg:sticky lg:top-10 lg:order-2", doc ? "order-2" : "order-1")}>
          <Panel aria-label="AI document">
            <PanelHeader title={doc ? "Regenerate with AI" : "Create with AI"} />
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
                disabled={!hasTranscript}
                onClick={generate}
              >
                {busy ? (status ?? "Writing… this can take a minute") : doc ? `Regenerate ${docWord}` : `Create ${docWord}`}
              </Button>
              {!hasTranscript && <p className="text-meta text-muted-foreground">This meeting has no transcript to work from.</p>}
              {error && (
                <p className="text-meta text-danger" role="alert">
                  {error}
                </p>
              )}
            </div>
          </Panel>

          <div className={cx(!doc && "max-lg:hidden")}>{exportPanel}</div>
        </aside>

        {/* Phones without a document: export + delete after the transcript */}
        {!doc && <div className="order-3 lg:hidden">{exportPanel}</div>}
      </div>
    </div>
  );
}

function ExportButtons(props: {
  name: string;
  busy: ExportKind | "share" | null;
  disabled: boolean;
  onShare: () => void;
  shareRef: RefObject<HTMLButtonElement | null>;
  shareOpen: boolean;
  menu: ReactNode;
  onTxt: () => void;
  onWord: () => void;
  onPdf: () => void;
}) {
  const any = props.busy !== null;
  const off = (k: ExportKind | "share") => props.disabled || (any && props.busy !== k);
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold">Export</h2>
        <span className="text-meta text-muted-foreground">{props.name}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button onClick={props.onPdf} loading={props.busy === "pdf"} disabled={off("pdf")} icon={<FileDown className="h-4 w-4" />} className="px-2">
          PDF
        </Button>
        <Button onClick={props.onWord} loading={props.busy === "docx"} disabled={off("docx")} icon={<FileType className="h-4 w-4" />} className="px-2">
          Word
        </Button>
        <Button onClick={props.onTxt} loading={props.busy === "txt"} disabled={off("txt")} icon={<FileText className="h-4 w-4" />} className="px-2">
          Text
        </Button>
      </div>
      <div className="relative mt-2">
        <Button
          ref={props.shareRef}
          onClick={props.onShare}
          loading={props.busy === "share"}
          disabled={off("share")}
          aria-haspopup="menu"
          aria-expanded={props.shareOpen}
          icon={<Share2 className="h-4 w-4" />}
          className="w-full"
        >
          {props.busy === "share" ? "Preparing…" : "Share meeting"}
        </Button>
        {props.menu}
      </div>
    </>
  );
}
