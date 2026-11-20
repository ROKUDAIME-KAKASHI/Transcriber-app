"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Loader2, Pencil, Share2, Sparkles, Trash2, Check, X, Calendar, Clock, Monitor, Smartphone,
  FileText, FileType, FileDown, Users, Radio,
} from "lucide-react";
import { TEMPLATES, formatDuration, transcriptToText, type TranscriptPart } from "@/lib/transcript";
import { DEFAULT_SUMMARY_MODEL, SUMMARY_MODELS, type SummaryModel } from "@/lib/aiModels";
import { TranscriptView } from "./TranscriptView";

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

const card = "rounded-3xl border border-border bg-card shadow-card";
const panelTitle = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

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
    pollDeadline.current = Date.now() + 4 * 60_000;
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

  const exportWord = () => {
    const el = document.getElementById("export-body");
    const html = el ? el.innerHTML : currentText.replace(/\n/g, "<br>");
    const source =
      "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>" +
      html +
      "</body></html>";
    download(new Blob([source], { type: "application/msword" }), `${currentName}-${fileStamp()}.doc`);
  };

  const exportPdf = async () => {
    const el = document.getElementById("export-body");
    if (!el) return;
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
        .from(el)
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
  const chip = "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-6">
      {/* ---------- Header ---------- */}
      <header>
        <Link href="/meetings" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Meetings
        </Link>
        <div className="mt-3">
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
                className="flex-1 min-w-0 rounded-2xl border border-accent bg-card px-4 py-2.5 text-xl font-semibold outline-none"
              />
              <button onClick={saveTitle} className={outlineBtn} aria-label="Save title"><Check className="w-4 h-4" /></button>
              <button
                onClick={() => {
                  setTitle(savedTitle);
                  setEditingTitle(false);
                }}
                className={outlineBtn}
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingTitle(true)} className="group text-left" title="Rename">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">
                {title}
                <Pencil className="inline w-4 h-4 ml-2 align-middle text-muted-foreground opacity-50 group-hover:opacity-100" />
              </h1>
            </button>
          )}
        </div>
        {titleError && <p className="mt-2 text-sm text-danger" role="alert">{titleError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={chip} suppressHydrationWarning>
            <Calendar className="w-3.5 h-3.5" />
            {new Date(meeting.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
          <span className={`${chip} tabular-nums`}><Clock className="w-3.5 h-3.5" /> {formatDuration(meeting.durationSec)}</span>
          {speakers > 1 && <span className={chip}><Users className="w-3.5 h-3.5" /> {speakers} speakers</span>}
          {meeting.deviceName && <span className={chip}><DeviceIcon className="w-3.5 h-3.5" /> {meeting.deviceName}</span>}
          {meeting.status === "RECORDING" && (
            <span className={`${chip} bg-danger/10 text-danger`}><Radio className="w-3.5 h-3.5" /> Still recording on a device</span>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* ---------- Side panel: AI + export ---------- */}
        {/* Phones: with a document, read it first and keep the AI panel below; without one, the panel leads. */}
        <aside className={`space-y-4 lg:order-2 lg:sticky lg:top-10 ${doc ? "max-lg:order-2" : ""}`}>
          <section className={`${card} p-5`} aria-label="AI document">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-accent/10 text-accent grid place-items-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <h2 className="font-semibold">AI document</h2>
            </div>

            <div className="mt-4">
              <span className={panelTitle}>Type</span>
              <div className="mt-2 grid grid-cols-2 p-1 bg-muted rounded-xl" role="radiogroup" aria-label="Document type">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.value}
                    role="radio"
                    aria-checked={template === t.value}
                    disabled={busy}
                    onClick={() => setTemplate(t.value)}
                    className={`min-h-11 py-2 text-sm font-medium rounded-lg disabled:opacity-60 ${
                      template === t.value ? "bg-card shadow-card" : "text-muted-foreground"
                    }`}
                  >
                    {t.value === "MOM" ? "Minutes" : t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4" role="radiogroup" aria-label="AI model">
              <span className={panelTitle}>AI model</span>
              <div className="mt-2 grid gap-2">
                {SUMMARY_MODELS.map((m) => {
                  const on = model === m.value;
                  const [name, tier] = [m.label.split(" · ")[1], m.label.split(" · ")[0]];
                  return (
                    <button
                      key={m.value}
                      role="radio"
                      aria-checked={on}
                      disabled={busy}
                      onClick={() => chooseModel(m.value)}
                      className={`rounded-2xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60 ${
                        on ? "border-accent bg-accent/8" : "border-border hover:bg-muted"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{name}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${on ? "text-accent" : "text-muted-foreground"}`}>
                          {tier}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground leading-relaxed">{m.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={generate}
              disabled={busy || meeting.transcript.length === 0}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-accent text-accent-foreground px-4 py-3 text-sm font-semibold hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {busy ? (status ?? "Writing… this can take a minute") : doc ? "Regenerate" : "Generate"}
            </button>
            {meeting.transcript.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">This meeting has no transcript to work from.</p>
            )}
            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
          </section>

          <section className={`${card} p-5 ${doc ? "" : "max-lg:hidden"}`} aria-label="Export">
            <ExportButtons
              name={currentName}
              canShare={canShare}
              onShare={share}
              onTxt={exportTxt}
              onWord={exportWord}
              onPdf={exportPdf}
              pdfBusy={pdfBusy}
            />
            {exportError && <p className="mt-3 text-sm text-danger" role="alert">{exportError}</p>}
            <button
              onClick={remove}
              className={`mt-4 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                confirmDelete ? "bg-danger text-white" : "text-danger hover:bg-danger/10"
              }`}
            >
              <Trash2 className="w-4 h-4" /> {confirmDelete ? "Tap again to delete" : "Delete meeting"}
            </button>
          </section>
        </aside>

        {/* ---------- Document / transcript ---------- */}
        <div className={`min-w-0 space-y-4 lg:order-1 ${doc ? "max-lg:order-1" : ""}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
              {(["document", "transcript"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  disabled={t === "document" && !doc}
                  className={`min-h-11 px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${
                    tab === t ? "bg-card shadow-card" : "text-muted-foreground"
                  }`}
                >
                  {t === "document" ? docName : "Transcript"}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{words} words</span>
          </div>

          <section className={`${card} p-5 sm:p-8`}>
            <div id="export-body">
              {showingDoc ? (
                <article className="prose prose-stone dark:prose-invert max-w-none prose-headings:tracking-tight prose-h1:text-xl prose-h1:mt-8 first:prose-h1:mt-0 prose-h2:text-lg prose-table:text-sm prose-th:bg-muted/60 prose-th:px-3 prose-td:px-3 [&_table]:block [&_table]:overflow-x-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{doc!}</Markdown>
                </article>
              ) : meeting.transcript.length > 0 ? (
                <TranscriptView parts={meeting.transcript} />
              ) : (
                <p className="text-muted-foreground text-sm">No transcript was captured.</p>
              )}
            </div>
            {!doc && meeting.transcript.length > 0 && (
              <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
                Want minutes? Pick a type and model{" "}
                <span className="lg:hidden">above</span>
                <span className="hidden lg:inline">on the right</span> and tap <strong className="text-foreground">Generate</strong>.
              </p>
            )}
          </section>

          {/* Phones/tablets: export + delete below the content (only when the AI panel isn't below it) */}
          <section className={`${card} p-5 lg:hidden ${doc ? "hidden" : ""}`} aria-label="Export">
            <ExportButtons
              name={currentName}
              canShare={canShare}
              onShare={share}
              onTxt={exportTxt}
              onWord={exportWord}
              onPdf={exportPdf}
              pdfBusy={pdfBusy}
            />
            {exportError && <p className="mt-3 text-sm text-danger" role="alert">{exportError}</p>}
            <button
              onClick={remove}
              className={`mt-4 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                confirmDelete ? "bg-danger text-white" : "text-danger hover:bg-danger/10"
              }`}
            >
              <Trash2 className="w-4 h-4" /> {confirmDelete ? "Tap again to delete" : "Delete meeting"}
            </button>
          </section>
        </div>
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
        <h2 className="font-semibold">Export</h2>
        <span className="text-xs text-muted-foreground">{props.name}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={props.onPdf} disabled={props.pdfBusy} className={outlineBtn}>
          {props.pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          {props.pdfBusy ? "Preparing…" : "PDF"}
        </button>
        <button onClick={props.onWord} className={outlineBtn}><FileType className="w-4 h-4" /> Word</button>
        <button onClick={props.onTxt} className={outlineBtn}><FileText className="w-4 h-4" /> TXT</button>
      </div>
      {props.canShare && (
        <button onClick={props.onShare} className={`${outlineBtn} mt-2 w-full`}>
          <Share2 className="w-4 h-4" /> Share
        </button>
      )}
    </>
  );
}
