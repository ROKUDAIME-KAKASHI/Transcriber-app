"use client";

import { useEffect, useState } from "react";
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
  a.click();
  URL.revokeObjectURL(url);
}

const card = "rounded-3xl border border-border bg-card shadow-card";
const panelTitle = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

export function MeetingView({ meeting }: { meeting: MeetingData }) {
  const router = useRouter();
  const [title, setTitle] = useState(meeting.title);
  const [savedTitle, setSavedTitle] = useState(meeting.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [template, setTemplate] = useState(meeting.template ?? "MOM");
  const [docTemplate, setDocTemplate] = useState(meeting.template ?? "MOM");
  const [document, setDocument] = useState(meeting.document);
  const [tab, setTab] = useState<"document" | "transcript">(meeting.document ? "document" : "transcript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const next = title.trim();
    if (!next || next === savedTitle) return setTitle(savedTitle);
    await fetch(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    setSavedTitle(next);
    router.refresh();
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Processing failed");
      setDocument(data.document);
      setDocTemplate(template);
      setTab("document");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this meeting and its transcript? This cannot be undone.")) return;
    await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    router.push("/meetings");
    router.refresh();
  };

  const docName = docTemplate === "Report" ? "Report" : "Minutes";
  const showingDoc = tab === "document" && !!document;
  const currentText = showingDoc ? document! : rawText;
  const currentName = showingDoc ? docName : "Transcript";

  const exportTxt = () =>
    download(new Blob([currentText], { type: "text/plain;charset=utf-8" }), `${currentName}-${fileStamp()}.txt`);

  const exportWord = () => {
    const el = window.document.getElementById("export-body");
    const html = el ? el.innerHTML : currentText.replace(/\n/g, "<br>");
    const source =
      "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>" +
      html +
      "</body></html>";
    download(new Blob([source], { type: "application/msword" }), `${currentName}-${fileStamp()}.doc`);
  };

  const exportPdf = async () => {
    const el = window.document.getElementById("export-body");
    if (!el) return;
    const html2pdf = (await import("html2pdf.js")).default;
    html2pdf()
      .set({
        margin: 0.75,
        filename: `${currentName}-${fileStamp()}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      } as Record<string, unknown>)
      .from(el)
      .save();
  };

  const share = async () => {
    try {
      await navigator.share({ title, text: currentText });
    } catch {
      /* user cancelled */
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
        <aside className={`space-y-4 lg:order-2 lg:sticky lg:top-10 ${document ? "max-lg:order-2" : ""}`}>
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
                    className={`py-2 text-sm font-medium rounded-lg disabled:opacity-60 ${
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
              {busy ? "Writing… this can take a minute" : document ? "Regenerate" : "Generate"}
            </button>
            {meeting.transcript.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">This meeting has no transcript to work from.</p>
            )}
            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
          </section>

          <section className={`${card} p-5 ${document ? "" : "max-lg:hidden"}`} aria-label="Export">
            <ExportButtons
              name={currentName}
              canShare={canShare}
              onShare={share}
              onTxt={exportTxt}
              onWord={exportWord}
              onPdf={exportPdf}
            />
            <button onClick={remove} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10">
              <Trash2 className="w-4 h-4" /> Delete meeting
            </button>
          </section>
        </aside>

        {/* ---------- Document / transcript ---------- */}
        <div className={`min-w-0 space-y-4 lg:order-1 ${document ? "max-lg:order-1" : ""}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
              {(["document", "transcript"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  disabled={t === "document" && !document}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${
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
                  <Markdown remarkPlugins={[remarkGfm]}>{document!}</Markdown>
                </article>
              ) : meeting.transcript.length > 0 ? (
                <TranscriptView parts={meeting.transcript} />
              ) : (
                <p className="text-muted-foreground text-sm">No transcript was captured.</p>
              )}
            </div>
            {!document && meeting.transcript.length > 0 && (
              <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
                Want minutes? Pick a type and model{" "}
                <span className="lg:hidden">above</span>
                <span className="hidden lg:inline">on the right</span> and tap <strong className="text-foreground">Generate</strong>.
              </p>
            )}
          </section>

          {/* Phones/tablets: export + delete below the content (only when the AI panel isn't below it) */}
          <section className={`${card} p-5 lg:hidden ${document ? "hidden" : ""}`} aria-label="Export">
            <ExportButtons
              name={currentName}
              canShare={canShare}
              onShare={share}
              onTxt={exportTxt}
              onWord={exportWord}
              onPdf={exportPdf}
            />
            <button onClick={remove} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10">
              <Trash2 className="w-4 h-4" /> Delete meeting
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
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Export</h2>
        <span className="text-xs text-muted-foreground">{props.name}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={props.onPdf} className={outlineBtn}><FileDown className="w-4 h-4" /> PDF</button>
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
