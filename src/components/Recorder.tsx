"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Mic, Square, Pause, Play, MessagesSquare, Cloud, CloudOff, Loader2, ArrowRight, PlayCircle, MicOff,
  Zap, Languages, Users, MonitorSpeaker,
} from "lucide-react";
import { useRecorder } from "@/hooks/useRecorder";
import { formatDuration } from "@/lib/transcript";
import { WHISPER_LANGUAGES } from "@/lib/speech/models";
import type { RecordEngine } from "@/lib/speech/deepgram";
import { TranscriptView } from "./TranscriptView";

const MIC_KEY = "transcriber.micId";
const ENGINE_KEY = "transcriber.engine";
const LANG_KEY = "transcriber.language";

const ENGINES: { value: RecordEngine; label: string; sub: string; icon: typeof Zap; hint: string }[] = [
  {
    value: "moonshine",
    label: "Fast",
    sub: "English · on device · free",
    icon: Zap,
    hint: "Moonshine: quick and light (~63 MB, downloaded once). Best with clear, standard English. Your audio never leaves this device.",
  },
  {
    value: "whisper",
    label: "Accurate",
    sub: "Hindi & accents · on device · free",
    icon: Languages,
    hint: "Whisper: better with Indian accents and understands Hindi. ~77 MB once, slower, and live text updates less often. Your audio never leaves this device.",
  },
  {
    value: "deepgram",
    label: "Cloud",
    sub: "Labels who is speaking · paid",
    icon: Users,
    hint: "Deepgram: live words and speaker labels, strong with Indian accents, Hindi and mixed speech. Needs internet; audio is sent to Deepgram and billed per minute.",
  },
];

/** Saves a choice for next time on this device. */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Lists microphones. Names only appear after the user has allowed mic access once. */
function useMicrophones() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const refresh = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "")))
      .catch(() => {});
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  return { mics, refresh };
}

function LevelMeter({ level, bars = 14 }: { level: number; bars?: number }) {
  const lit = Math.round(level * bars);
  return (
    <div
      className="flex items-end gap-[3px] h-5"
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-1 rounded-full transition-colors ${i < lit ? (i >= bars - 2 ? "bg-danger" : "bg-accent") : "bg-border"}`}
          style={{ height: `${25 + (i / (bars - 1)) * 75}%` }}
        />
      ))}
    </div>
  );
}

function RecDot({ paused }: { paused: boolean }) {
  if (paused) return <Pause className="w-3.5 h-3.5 fill-current" />;
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger" />
    </span>
  );
}

const fieldLabel = "block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2";
const selectCls =
  "select w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-base sm:text-sm font-medium outline-none focus:border-accent disabled:opacity-60";

export function Recorder() {
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [canCaptureSystem, setCanCaptureSystem] = useState(false);
  const [micId, setMicId] = useState("");
  const { mics, refresh: refreshMics } = useMicrophones();
  const [engine, setEngine] = useState<RecordEngine>("moonshine");
  const [language, setLanguage] = useState("en");
  const rec = useRecorder({ captureSystemAudio, deviceId: micId, engine, language });
  const bottomRef = useRef<HTMLDivElement>(null);

  // getDisplayMedia (tab/system audio) is desktop-only.
  useEffect(() => {
    setCanCaptureSystem(!!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent));
    try {
      setMicId(localStorage.getItem(MIC_KEY) ?? "");
      const savedEngine = localStorage.getItem(ENGINE_KEY);
      if (savedEngine === "moonshine" || savedEngine === "whisper" || savedEngine === "deepgram") setEngine(savedEngine);
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang && WHISPER_LANGUAGES.some((l) => l.value === savedLang)) setLanguage(savedLang);
    } catch {
      /* storage blocked — keep the defaults */
    }
  }, []);

  // Device names become available once mic permission is granted, i.e. after recording starts.
  useEffect(() => {
    if (rec.isRecording) refreshMics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.isRecording]);

  useEffect(() => {
    if (rec.isRecording) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rec.transcriptParts, rec.interimText, rec.liveStatus, rec.isRecording]);

  // Phones opening the laptop's http://192.168.x.x address: no mic, no audio processing. Say so up front.
  const [insecure, setInsecure] = useState(false);
  useEffect(() => setInsecure(!window.isSecureContext), []);

  const hasTranscript = rec.transcriptParts.length > 0;
  const hasLive = !!rec.interimText || !!rec.liveStatus;
  const current = ENGINES.find((e) => e.value === engine) ?? ENGINES[0];
  const busy = rec.isRecording;
  const starting = rec.isStarting;
  /** Settings are locked while starting or recording. */
  const locked = busy || starting;
  /** Finished and fully saved: safe to open the meeting page. */
  const finished = !busy && !starting && !!rec.meetingId && hasTranscript && rec.saveState === "saved";
  const words = rec.transcriptParts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);

  const saveBadge = rec.meetingId && (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {rec.saveState === "saving" && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>}
      {rec.saveState === "saved" && <><Cloud className="w-3.5 h-3.5 text-success" /> Saved</>}
      {rec.saveState === "error" && <><CloudOff className="w-3.5 h-3.5 text-danger" /> Offline — will retry</>}
    </span>
  );

  return (
    <div className="grid gap-5 lg:gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
      {/* ---------- Controls ---------- */}
      <section
        className={`rounded-3xl border border-border bg-card shadow-card p-5 sm:p-6 lg:sticky lg:top-10 ${
          busy ? "max-lg:hidden" : ""
        }`}
        aria-label="Recording controls"
      >
        {finished && (
          // Phones: the transcript and its button are below the fold after Stop, so offer it up here.
          <Link
            href={`/meetings/${rec.meetingId}`}
            className="lg:hidden -mt-1 mb-5 flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm"
          >
            <Cloud className="w-4.5 h-4.5 text-success shrink-0" />
            <span className="flex-1">
              <span className="block font-semibold">Meeting saved</span>
              <span className="block text-xs text-muted-foreground">Open it for minutes and export</span>
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </Link>
        )}
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-4">
            <button
              onClick={busy ? rec.stop : starting ? undefined : () => rec.start("mic")}
              disabled={starting || insecure}
              className={`relative w-24 h-24 rounded-full grid place-items-center shadow-lg transition-transform active:scale-95 disabled:active:scale-100 ${
                busy ? "bg-danger text-white" : "bg-accent text-accent-foreground"
              } ${insecure ? "opacity-50" : ""}`}
              aria-label={busy ? "Stop recording" : starting ? "Starting recording" : "Start recording"}
            >
              {!busy && <span className={`absolute inset-0 rounded-full ring-8 ring-accent/15 ${starting ? "animate-pulse" : ""}`} aria-hidden />}
              {busy ? (
                <Square className="w-8 h-8 fill-current" />
              ) : starting ? (
                <Loader2 className="w-10 h-10 animate-spin" />
              ) : (
                <Mic className="w-10 h-10" />
              )}
            </button>
            {busy && (
              // Pause sits beside Stop so a break doesn't end (and save) the meeting.
              <button
                onClick={rec.isPaused ? rec.resume : rec.pause}
                className="w-14 h-14 rounded-full grid place-items-center border border-border bg-muted active:scale-95"
                aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
              >
                {rec.isPaused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
              </button>
            )}
          </div>

          <div className="mt-4 min-h-[3.25rem]">
            {busy ? (
              <div
                className={`flex items-center justify-center gap-2 text-2xl font-semibold tabular-nums ${
                  rec.isPaused ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                <RecDot paused={rec.isPaused} />
                {formatDuration(rec.recordingSeconds)}
              </div>
            ) : starting ? (
              <div className="text-lg font-semibold">Getting ready…</div>
            ) : (
              <div className="text-lg font-semibold">Tap to record</div>
            )}
            <p className="text-sm text-muted-foreground mt-1" aria-live="polite">{rec.statusMsg}</p>
          </div>

          {busy && !rec.isPaused && (
            <div className="mt-2 flex items-center gap-2 text-muted-foreground">
              <Mic className="w-4 h-4" /> <LevelMeter level={rec.micLevel} />
            </div>
          )}

          {starting && (
            <button
              onClick={rec.cancelStart}
              className="mt-2 min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          )}
          {!busy && !starting && !insecure && (
            <button
              onClick={() => rec.start("sample")}
              className="mt-1 min-h-11 inline-flex items-center gap-1.5 px-2 text-sm font-medium text-accent hover:underline"
            >
              <PlayCircle className="w-4 h-4" /> No mic? Try with sample audio
            </button>
          )}
          {insecure && (
            <div className="mt-4 w-full rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-left text-sm" role="alert">
              <strong className="block">Recording needs a secure https:// address</strong>
              <span className="text-muted-foreground">
                This page was opened over plain http://, so the browser blocks the microphone. On a phone, open
                the app&apos;s <strong className="text-foreground">https://</strong> link instead (see “Testing on a phone” in the README).
              </span>
            </div>
          )}
        </div>

        {busy && rec.noSound && <NoSoundWarning />}

        <div className="mt-6 space-y-5">
          <div role="radiogroup" aria-label="Speech engine">
            <span className={fieldLabel}>Speech engine</span>
            <div className="grid gap-2">
              {ENGINES.map((e) => {
                const on = engine === e.value;
                return (
                  <button
                    key={e.value}
                    role="radio"
                    aria-checked={on}
                    disabled={locked}
                    onClick={() => {
                      setEngine(e.value);
                      remember(ENGINE_KEY, e.value);
                    }}
                    className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60 ${
                      on ? "border-accent bg-accent/8" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`w-9 h-9 shrink-0 rounded-xl grid place-items-center ${
                        on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <e.icon className="w-4.5 h-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{e.label}</span>
                      <span className="block text-xs text-muted-foreground truncate">{e.sub}</span>
                    </span>
                    <span
                      className={`w-4 h-4 shrink-0 rounded-full border-2 ${on ? "border-accent bg-accent shadow-[inset_0_0_0_2px_var(--card)]" : "border-border"}`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{current.hint}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            <label className="block">
              <span className={fieldLabel}>Language</span>
              {engine === "moonshine" ? (
                <select disabled className={selectCls} aria-label="Language">
                  <option>English</option>
                </select>
              ) : (
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    remember(LANG_KEY, e.target.value);
                  }}
                  disabled={locked}
                  className={selectCls}
                >
                  {WHISPER_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              )}
            </label>

            <label className="block">
              <span className={fieldLabel}>Microphone</span>
              <select
                value={mics.some((m) => m.deviceId === micId) ? micId : ""}
                onChange={(e) => {
                  setMicId(e.target.value);
                  remember(MIC_KEY, e.target.value);
                }}
                disabled={locked || mics.length === 0}
                className={selectCls}
              >
                <option value="">Default microphone</option>
                {mics
                  .filter((m) => m.deviceId !== "default")
                  .map((m, i) => (
                    <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>
                  ))}
              </select>
            </label>
          </div>

          {canCaptureSystem && (
            <label className="flex items-start gap-3 rounded-2xl border border-border px-3.5 py-3 cursor-pointer hover:bg-muted has-[:disabled]:opacity-60">
              <MonitorSpeaker className="w-4.5 h-4.5 mt-0.5 text-muted-foreground shrink-0" />
              <span className="flex-1">
                <span className="block text-sm font-semibold">Also capture tab audio</span>
                <span className="block text-xs text-muted-foreground">For Zoom, Meet or Teams in this browser</span>
              </span>
              <input
                type="checkbox"
                checked={captureSystemAudio}
                onChange={(e) => setCaptureSystemAudio(e.target.checked)}
                disabled={locked}
                className="mt-1 w-4 h-4 accent-[var(--accent)]"
              />
            </label>
          )}

          {(saveBadge || busy) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              {saveBadge}
              {busy && <span className="text-xs text-muted-foreground">Keep this screen open while recording.</span>}
            </div>
          )}
        </div>
      </section>

      {/* ---------- Transcript ---------- */}
      <section
        className="rounded-3xl border border-border bg-card shadow-card flex flex-col lg:h-[calc(100dvh-5rem)] lg:sticky lg:top-10"
        aria-label="Live transcript"
      >
        <header className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="font-semibold">Live transcript</h1>
            {busy && !rec.isPaused && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 text-danger px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                <RecDot paused={false} /> Live
              </span>
            )}
            {busy && rec.isPaused && (
              <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                Paused
              </span>
            )}
          </div>
          {hasTranscript && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{words} words</span>}
        </header>

        <div className="flex-1 lg:overflow-y-auto scroll-thin px-4 sm:px-6 py-5 min-h-[45dvh]">
          {busy && rec.noSound && (
            <div className="lg:hidden mb-4">
              <NoSoundWarning />
            </div>
          )}
          {!hasTranscript && !hasLive ? (
            <div className="h-full min-h-[40dvh] flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
              <span className="w-14 h-14 rounded-2xl bg-muted grid place-items-center">
                <MessagesSquare className="w-7 h-7" />
              </span>
              <p className="font-medium text-foreground">{busy ? "Listening…" : "Nothing recorded yet"}</p>
              <p className="text-sm max-w-xs">
                The conversation appears here as a live chat while you record. Everything is saved to your account as you go.
              </p>
            </div>
          ) : (
            <TranscriptView
              parts={rec.transcriptParts}
              interimText={rec.interimText}
              liveStatus={rec.liveStatus}
              backlog={rec.backlog}
            />
          )}
          {/* scroll margin keeps the newest line clear of the phone controls when auto-scrolling */}
          <div ref={bottomRef} className="scroll-mb-48 lg:scroll-mb-6" />
        </div>

        {finished && (
          <div className="p-4 sm:px-6 border-t border-border">
            <Link
              href={`/meetings/${rec.meetingId}`}
              className="flex items-center justify-center gap-2 w-full rounded-2xl bg-accent text-accent-foreground py-3 font-semibold hover:opacity-95"
            >
              Open meeting — minutes & export <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </section>

      {/* ---------- Phone recording dock (above the tab bar) ---------- */}
      {busy && <div className="lg:hidden h-16" aria-hidden />}
      {busy && (
        <div className="lg:hidden pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2">
          <div className="pointer-events-auto mx-auto max-w-md rounded-3xl border border-border bg-card/95 backdrop-blur-md shadow-xl px-4 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-2 text-lg font-semibold tabular-nums ${rec.isPaused ? "text-muted-foreground" : ""}`}>
                <RecDot paused={rec.isPaused} />
                {formatDuration(rec.recordingSeconds)}
                {!rec.isPaused && <span className="ml-1"><LevelMeter level={rec.micLevel} bars={8} /></span>}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{rec.statusMsg}</p>
            </div>
            <button
              onClick={rec.isPaused ? rec.resume : rec.pause}
              className="w-12 h-12 shrink-0 rounded-full grid place-items-center border border-border bg-muted active:scale-95"
              aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
            >
              {rec.isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
            </button>
            <button
              onClick={rec.stop}
              className="w-12 h-12 shrink-0 rounded-full grid place-items-center bg-danger text-white shadow-md active:scale-95"
              aria-label="Stop recording"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoSoundWarning() {
  return (
    <div className="mt-4 rounded-2xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-left flex gap-2.5" role="alert">
      <MicOff className="w-4 h-4 text-danger shrink-0 mt-0.5" />
      <span>
        <strong>No sound from the microphone.</strong> Stop, pick another microphone, and try again. On Windows also
        check Settings → System → Sound → Input, and that the mic isn&apos;t muted.
      </span>
    </div>
  );
}
