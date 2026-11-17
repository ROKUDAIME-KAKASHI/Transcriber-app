"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Square, Volume2, Cloud, CloudOff, Loader2, ArrowRight, PlayCircle } from "lucide-react";
import { useRecorder, type Engine } from "@/hooks/useRecorder";
import { LANGUAGES, formatDuration } from "@/lib/transcript";
import { TranscriptView } from "./TranscriptView";

const ENGINE_KEY = "transcriber.engine";

const ENGINES: { value: Engine; label: string; hint: string }[] = [
  { value: "moonshine", label: "Free · on-device", hint: "English only, no speaker labels. Audio never leaves this device." },
  { value: "deepgram", label: "Deepgram", hint: "Live words, speaker labels, Indian languages." },
];

export function Recorder() {
  const [engine, setEngine] = useState<Engine>("deepgram");
  const [language, setLanguage] = useState("en");
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [canCaptureSystem, setCanCaptureSystem] = useState(false);
  const rec = useRecorder({ language, captureSystemAudio, engine });
  const bottomRef = useRef<HTMLDivElement>(null);

  // getDisplayMedia (tab/system audio) is desktop-only.
  useEffect(() => {
    setCanCaptureSystem(!!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent));
    try {
      const saved = localStorage.getItem(ENGINE_KEY);
      if (saved === "moonshine" || saved === "deepgram") setEngine(saved);
    } catch {
      /* storage blocked — keep the default */
    }
  }, []);

  const chooseEngine = (value: Engine) => {
    setEngine(value);
    try {
      localStorage.setItem(ENGINE_KEY, value);
    } catch {
      /* ignore */
    }
  };

  const isFree = engine === "moonshine";

  useEffect(() => {
    if (rec.isRecording) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rec.transcriptParts, rec.interimText, rec.isRecording]);

  const hasTranscript = rec.transcriptParts.length > 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center gap-4 text-center">
        <button
          onClick={rec.isRecording ? rec.stop : () => rec.start("mic")}
          className={`w-24 h-24 rounded-full grid place-items-center shadow-lg transition-transform active:scale-95 ${
            rec.isRecording ? "bg-danger text-white" : "bg-accent text-accent-foreground"
          }`}
          aria-label={rec.isRecording ? "Stop recording" : "Start recording"}
        >
          {rec.isRecording ? <Square className="w-9 h-9 fill-current" /> : <Mic className="w-10 h-10" />}
        </button>

        {!rec.isRecording && (
          <button
            onClick={() => rec.start("sample")}
            className="-mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <PlayCircle className="w-4 h-4" /> No mic? Try with sample audio
          </button>
        )}

        <div className="min-h-[3rem]">
          {rec.isRecording ? (
            <div className="flex items-center justify-center gap-2 text-danger font-semibold text-xl tabular-nums">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-danger" />
              </span>
              {formatDuration(rec.recordingSeconds)}
            </div>
          ) : (
            <div className="font-semibold text-lg">Tap to record</div>
          )}
          <p className="text-sm text-muted-foreground mt-1">{rec.statusMsg}</p>
        </div>

        <div className="w-full max-w-sm">
          <div className="grid grid-cols-2 p-1 bg-muted rounded-xl" role="radiogroup" aria-label="Transcription engine">
            {ENGINES.map((e) => (
              <button
                key={e.value}
                role="radio"
                aria-checked={engine === e.value}
                onClick={() => chooseEngine(e.value)}
                disabled={rec.isRecording}
                className={`py-2 text-sm font-medium rounded-lg disabled:opacity-60 ${
                  engine === e.value ? "bg-card shadow-sm" : "text-muted-foreground"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{ENGINES.find((e) => e.value === engine)?.hint}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {isFree ? (
            <span className="bg-muted border border-border rounded-full px-4 py-2 text-sm font-medium">English</span>
          ) : (
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={rec.isRecording}
              className="bg-muted border border-border rounded-full px-4 py-2 text-sm font-medium outline-none disabled:opacity-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          )}

          {canCaptureSystem && (
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={captureSystemAudio}
                onChange={(e) => setCaptureSystemAudio(e.target.checked)}
                disabled={rec.isRecording}
                className="w-4 h-4"
              />
              Also capture tab audio (Zoom/Meet)
            </label>
          )}
        </div>

        {rec.meetingId && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {rec.saveState === "saving" && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>}
            {rec.saveState === "saved" && <><Cloud className="w-3.5 h-3.5" /> Saved to your account</>}
            {rec.saveState === "error" && <><CloudOff className="w-3.5 h-3.5 text-danger" /> Offline — will retry</>}
          </div>
        )}

        {rec.isRecording && (
          <p className="text-xs text-muted-foreground max-w-sm">
            Keep this screen open while recording. Phones may pause the microphone if you switch apps.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 min-h-[300px]">
        {!hasTranscript && !rec.interimText ? (
          <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground text-center gap-2">
            <Volume2 className="w-12 h-12 opacity-40" />
            <p className="text-sm max-w-xs">
              Live transcript with speaker labels appears here. Everything is saved to your account as you go.
            </p>
          </div>
        ) : (
          <TranscriptView parts={rec.transcriptParts} interimText={rec.interimText} />
        )}
        {/* scroll margin keeps the newest line clear of the phone tab bar when auto-scrolling */}
        <div ref={bottomRef} className="scroll-mb-28 sm:scroll-mb-6" />
      </section>

      {!rec.isRecording && rec.meetingId && hasTranscript && (
        <Link
          href={`/meetings/${rec.meetingId}`}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent text-accent-foreground py-3 font-semibold"
        >
          Open meeting — create minutes & export <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
