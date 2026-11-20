"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  transcript: TranscriptPart[];
}

const fileStamp = () => new Date().toISOString().slice(0, 10);
const MODEL_KEY = "transcriber.summaryModel";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away breaks downloads on iOS and Android WebViews.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}


export function MeetingView({ meeting }: { meeting: MeetingData }) {
  const router = useRouter();
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
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const rawText = transcriptToText(meeting.transcript);
  const speakers = new Set(meeting.transcript.map((p) => p.speaker)).size;
  const words = meeting.transcript.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(!!navigator.share), []);

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

  const saveTitle = async () => {
    setEditingTitle(false);
    setTitleError(null);
    const next = title.trim();
    if (!next || next === savedTitle) return setTitle(savedTitle);
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
  }, [meeting.id, stopPolling]);

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

  const exportTxt = () =>
    download(new Blob([currentText], { type: "text/plain;charset=utf-8" }), `${currentName}-${fileStamp()}.txt`);

  /**
   * HTML for Word/PDF. The transcript view only draws part of a long meeting, so transcript
   * exports are built from the full data instead of copying what's on screen.
   */
  const exportHtml = (): string => {
    const el = document.getElementById("export-body");
    if (showingDoc && el) return el.innerHTML;
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const multi = speakers > 1;
    return (
      `<h1 style="font-size:18pt">${esc(title)}</h1>` +
      meeting.transcript
        .map((p) => {
          const time = typeof p.t === "number" ? `<span style="color:#666">[${formatDuration(Math.floor(p.t))}]</span> ` : "";
          const who = multi ? `<strong>Speaker ${p.speaker + 1}:</strong> ` : "";
          return `<p style="margin:0 0 6pt">${time}${who}${esc(p.text)}</p>`;
        })
        .join("")
    );
  };

  const exportWord = () => {
    const html = exportHtml();
    const source =
      "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>" +
      html +
      "</body></html>";
    download(new Blob([source], { type: "application/msword" }), `${currentName}-${fileStamp()}.doc`);
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    setExportError(null);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: 0.75,
          filename: `${currentName}-${fileStamp()}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: window.innerWidth < 768 ? 1 : 2 },
          jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        } as Record<string, unknown>)
        .from(
          Object.assign(document.createElement("div"), {
            innerHTML: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111">${exportHtml()}</div>`,
          })
        )
        .save();
    } catch (e) {
      console.error("PDF export failed:", e);
      setExportError("Couldn't make the PDF. Try Word or TXT instead.");
    } finally {
      setPdfBusy(false);
    }
  };

  const share = async () => {
    setExportError(null);
    try {
      await navigator.share({ title, text: currentText });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
      setExportError("Couldn't share. Try TXT instead.");
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
    <Panel className="p-5" aria-label="Export">
      <ExportButtons
        name={currentName}
        canShare={canShare}
        onShare={share}
        onTxt={exportTxt}
        onWord={exportWord}
        onPdf={exportPdf}
        pdfBusy={pdfBusy}
      />
      {exportError && <p className="mt-3 text-meta text-danger" role="alert">{exportError}</p>}
      <div className="mt-4 border-t border-border pt-4">{deleteButton}</div>
    </Panel>
  );

  const docWord = template === "Report" ? "report" : "minutes";

  return (
    <div>
      {/* ---------- Header ---------- */}
      <header className="mb-6 sm:mb-8">
        <Link href="/meetings" className="inline-flex min-h-10 items-center gap-1.5 text-meta font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Meetings
        </Link>
        <div className="mt-1">
          {editingTitle ? (
            <div className="flex gap-2">
              <input
                autoFocus
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
            <div id="export-body">
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
  canShare: boolean;
  onShare: () => void;
  onTxt: () => void;
  onWord: () => void;
  onPdf: () => void;
  pdfBusy: boolean;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold">Export</h2>
        <span className="text-meta text-muted-foreground">{props.name}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button onClick={props.onPdf} loading={props.pdfBusy} icon={<FileDown className="h-4 w-4" />} className="px-2">
          PDF
        </Button>
        <Button onClick={props.onWord} icon={<FileType className="h-4 w-4" />} className="px-2">
          Word
        </Button>
        <Button onClick={props.onTxt} icon={<FileText className="h-4 w-4" />} className="px-2">
          Text
        </Button>
      </div>
      {props.canShare && (
        <Button onClick={props.onShare} icon={<Share2 className="h-4 w-4" />} className="mt-2 w-full">
          Share
        </Button>
      )}
    </>
  );
}
