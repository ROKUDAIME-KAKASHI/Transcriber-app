"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Download, Loader2, Pencil, Share2, Sparkles, Trash2, Check } from "lucide-react";
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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const MODEL_KEY = "transcriber.summaryModel";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

export function MeetingView({ meeting }: { meeting: MeetingData }) {
  const router = useRouter();
  const [title, setTitle] = useState(meeting.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [template, setTemplate] = useState(meeting.template ?? "MOM");
  const [document, setDocument] = useState(meeting.document);
  const [tab, setTab] = useState<"document" | "transcript">(meeting.document ? "document" : "transcript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawText = transcriptToText(meeting.transcript);
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
    if (!title.trim() || title === meeting.title) return;
    await fetch(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
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

  const currentText = tab === "document" && document ? document : rawText;
  const currentName = tab === "document" && document ? (template === "Report" ? "Report" : "Minutes") : "Transcript";

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

  return (
    <div className="space-y-5">
      <Link href="/meetings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> All meetings
      </Link>

      <header>
        {editingTitle ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTitle()}
              className="flex-1 min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-lg font-semibold outline-none focus:border-accent"
            />
            <button onClick={saveTitle} className={btn} aria-label="Save title"><Check className="w-4 h-4" /></button>
          </div>
        ) : (
          <button onClick={() => setEditingTitle(true)} className="group text-left">
            <h1 className="text-2xl font-bold tracking-tight break-words">
              {title}
              <Pencil className="inline w-4 h-4 ml-2 text-muted-foreground opacity-60 group-hover:opacity-100" />
            </h1>
          </button>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          {new Date(meeting.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          {" · "}{formatDuration(meeting.durationSec)}
          {meeting.deviceName && ` · ${meeting.deviceName}`}
          {meeting.status === "RECORDING" && " · still recording on a device"}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-3">
        <select
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          disabled={busy}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium outline-none"
        >
          {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          value={model}
          onChange={(e) => chooseModel(e.target.value as SummaryModel)}
          disabled={busy}
          aria-label="AI model"
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium outline-none"
        >
          {SUMMARY_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button
          onClick={generate}
          disabled={busy || meeting.transcript.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-accent text-accent-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? "Generating…" : document ? "Regenerate with AI" : "Generate with AI"}
        </button>
        <p className="w-full text-xs text-muted-foreground">{SUMMARY_MODELS.find((m) => m.value === model)?.hint}</p>
        {error && <p className="w-full text-sm text-danger">{error}</p>}
      </section>

      <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit">
        {(["document", "transcript"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t === "document" && !document}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize disabled:opacity-40 ${
              tab === t ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t === "document" ? (template === "Report" ? "Report" : "Minutes") : "Transcript"}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div id="export-body">
          {tab === "document" && document ? (
            <article className="prose prose-stone dark:prose-invert max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{document}</Markdown>
            </article>
          ) : meeting.transcript.length > 0 ? (
            <TranscriptView parts={meeting.transcript} />
          ) : (
            <p className="text-muted-foreground text-sm">No transcript was captured.</p>
          )}
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {canShare && <button onClick={share} className={btn}><Share2 className="w-4 h-4" /> Share</button>}
        <button onClick={exportTxt} className={btn}><Download className="w-4 h-4" /> TXT</button>
        <button onClick={exportWord} className={btn}><Download className="w-4 h-4" /> Word</button>
        <button onClick={exportPdf} className={btn}><Download className="w-4 h-4" /> PDF</button>
        <button onClick={remove} className={`${btn} ml-auto text-danger`}><Trash2 className="w-4 h-4" /> Delete</button>
      </section>
    </div>
  );
}
