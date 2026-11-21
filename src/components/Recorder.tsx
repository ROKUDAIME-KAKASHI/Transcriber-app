"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Mic, Square, Pause, Play, Cloud, CloudOff, Loader2, ArrowRight, PlayCircle, MicOff, Zap, Languages, Users,
  MonitorSpeaker, HardDrive, ShieldAlert, BatteryCharging, BatteryWarning, FileText,
} from "lucide-react";
import { useRecorder } from "@/hooks/useRecorder";
import { useBatteryRestriction, useNativeRecorder } from "@/hooks/useNativeRecorder";
import { isNativeApp } from "@/lib/nativeRecorder";
import { setWebRecording } from "@/lib/recordingFlag";
import { formatDuration } from "@/lib/transcript";
import { WHISPER_LANGUAGES } from "@/lib/speech/models";
import type { RecordEngine } from "@/lib/speech/deepgram";
import { TranscriptView } from "./TranscriptView";
import { Badge, Button, FieldLabel, LiveDot, Notice, OptionList, Panel, PanelHeader, cx, selectCls } from "./ui";

const MIC_KEY = "transcriber.micId";
const ENGINE_KEY = "transcriber.engine";
const LANG_KEY = "transcriber.language";

const ENGINES: { value: RecordEngine; title: string; description: string; aside: string; icon: React.ReactNode }[] = [
  {
    value: "moonshine",
    title: "Fast",
    description: "English only. Runs on this device; audio never leaves it.",
    aside: "Free",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    value: "whisper",
    title: "Accurate",
    description: "Indian accents and Hindi. On this device; slower live text.",
    aside: "Free",
    icon: <Languages className="h-4 w-4" />,
  },
  {
    value: "deepgram",
    title: "Cloud",
    description: "Labels each speaker. Needs internet; audio goes to Deepgram.",
    aside: "Paid",
    icon: <Users className="h-4 w-4" />,
  },
];

/** Engine notes inside the Android app, where only cloud mode runs with the screen off. */
const APP_ENGINE_NOTES: Record<RecordEngine, string> = {
  moonshine: "English only, on this phone. Keep the screen on while recording.",
  whisper: "Indian accents and Hindi, on this phone. Keep the screen on while recording.",
  deepgram: "Labels each speaker. Keeps recording with the screen off. Needs internet.",
};

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

function LevelMeter({ level, bars = 24 }: { level: number; bars?: number }) {
  const lit = Math.round(level * bars);
  return (
    <div
      className="flex h-6 items-center gap-[3px]"
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: bars }, (_, i) => {
        // A gentle arch, so the meter reads as a waveform rather than a bar chart.
        const shape = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / bars);
        return (
          <span
            key={i}
            className={cx("w-[3px] rounded-full transition-colors", i < lit ? (i >= bars - 3 ? "bg-danger" : "bg-foreground") : "bg-border")}
            style={{ height: `${Math.round(shape * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

export function Recorder() {
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [canCaptureSystem, setCanCaptureSystem] = useState(false);
  const [micId, setMicId] = useState("");
  const { mics, refresh: refreshMics } = useMicrophones();
  const [engine, setEngine] = useState<RecordEngine>("moonshine");
  const [language, setLanguage] = useState("en");
  const webRec = useRecorder({ captureSystemAudio, deviceId: micId, engine, language });
  const nativeRec = useNativeRecorder({ language });
  // Android app: cloud mode records in a native service that keeps going with the screen off.
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isNativeApp()), []);
  const nativeMode = inApp && (engine === "deepgram" || nativeRec.isRecording || nativeRec.isStarting);
  const rec = nativeMode ? nativeRec : webRec;
  useEffect(() => {
    setWebRecording(rec.isRecording);
  }, [rec.isRecording]);
  useEffect(() => () => setWebRecording(false), []);
  const battery = useBatteryRestriction(inApp);
  const bottomRef = useRef<HTMLDivElement>(null);

  // getDisplayMedia (tab/system audio) is desktop-only.
  useEffect(() => {
    setCanCaptureSystem(!!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent));
    try {
      setMicId(localStorage.getItem(MIC_KEY) ?? "");
      const savedEngine = localStorage.getItem(ENGINE_KEY);
      if (savedEngine === "moonshine" || savedEngine === "whisper" || savedEngine === "deepgram") setEngine(savedEngine);
      // In the Android app, default to cloud: it's the mode that records with the screen off.
      else if (isNativeApp()) setEngine("deepgram");
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
  // The app's native recorder doesn't need a secure page (only the browser's microphone does).
  const blocked = insecure && !nativeMode;

  const hasTranscript = rec.transcriptParts.length > 0;
  const hasLive = !!rec.interimText || !!rec.liveStatus;
  const busy = rec.isRecording;
  const starting = rec.isStarting;
  /** Settings are locked while starting or recording. */
  const locked = busy || starting;
  /** Finished and fully saved: safe to open the meeting page. */
  const finished = !busy && !starting && !!rec.meetingId && hasTranscript && (rec.saveState === "saved" || rec.saveState === "local");
  // Memoised: recounting thousands of phrases on every mic-level update made long meetings sluggish.
  const words = useMemo(
    () => rec.transcriptParts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    [rec.transcriptParts]
  );

  const stateLabel = busy ? (rec.isPaused ? "Paused" : "Recording") : starting ? "Getting ready" : "Ready";

  const saveStatus = rec.meetingId && (
    <span className="inline-flex items-center gap-1.5">
      {rec.saveState === "saving" && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving</>}
      {rec.saveState === "saved" && <><Cloud className="h-3.5 w-3.5 text-success" /> Synced</>}
      {rec.saveState === "local" && (
        <><HardDrive className="h-3.5 w-3.5 text-success" /> Saved on this device{rec.syncNote ? ` · ${rec.syncNote}` : ""}</>
      )}
      {rec.saveState === "error" && <><CloudOff className="h-3.5 w-3.5 text-danger" /> Offline · will retry</>}
    </span>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* ---------- Session controls ---------- */}
      <Panel as="section" aria-label="Recording controls" className={cx("lg:sticky lg:top-10", busy && "max-lg:hidden")}>
        {finished && (
          // Phones: the transcript is below the fold after Stop, so offer the meeting up here.
          <Link
            href={`/meeting?id=${rec.meetingId}`}
            className="flex items-center gap-3 border-b border-border px-5 py-3.5 text-ui hover:bg-muted/50 lg:hidden"
          >
            <FileText className="h-4 w-4 shrink-0 text-success" />
            <span className="flex-1">
              <span className="block font-medium">Meeting saved</span>
              <span className="block text-meta text-muted-foreground">Open it for minutes and export</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}

        <div className="px-5 pb-5 pt-6 text-center">
          <div className="flex items-center justify-center gap-2 text-meta font-medium text-muted-foreground">
            {busy && <LiveDot paused={rec.isPaused} />}
            {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {stateLabel}
          </div>
          <div
            className={cx(
              "mt-1 text-[2.5rem] font-semibold leading-tight tracking-tight tabular-nums",
              busy || starting ? "text-foreground" : "text-muted-foreground/60"
            )}
          >
            {formatDuration(rec.recordingSeconds)}
          </div>
          <p className="mx-auto mt-1 min-h-[1.25rem] max-w-[30ch] text-meta text-muted-foreground" aria-live="polite">
            {rec.statusMsg === "Ready" ? "Choose an engine below, then start." : rec.statusMsg}
          </p>

          <div className="mt-3 flex h-6 justify-center">{busy && !rec.isPaused && <LevelMeter level={rec.micLevel} />}</div>

          <div className="mt-4 flex items-center justify-center gap-4">
            {busy ? (
              <>
                <button
                  onClick={rec.isPaused ? rec.resume : rec.pause}
                  className="grid h-14 w-14 place-items-center rounded-full border border-border bg-card hover:bg-muted active:scale-95"
                  aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
                >
                  {rec.isPaused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
                </button>
                <button
                  onClick={rec.stop}
                  className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-danger text-white hover:bg-danger/90 active:scale-95"
                  aria-label="Stop recording"
                >
                  <Square className="h-6 w-6 fill-current" />
                </button>
              </>
            ) : (
              <button
                onClick={starting ? undefined : () => rec.start("mic")}
                disabled={starting || blocked}
                className={cx(
                  "grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-danger text-white transition-transform",
                  "hover:bg-danger/90 active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100",
                  blocked && "opacity-40"
                )}
                aria-label={starting ? "Starting recording" : "Start recording"}
              >
                {starting ? <Loader2 className="h-7 w-7 animate-spin" /> : <Mic className="h-7 w-7" />}
              </button>
            )}
          </div>

          <div className="mt-3 flex min-h-11 items-center justify-center">
            {starting ? (
              <Button variant="ghost" onClick={rec.cancelStart}>Cancel</Button>
            ) : !busy && !blocked && !nativeMode ? (
              <Button variant="ghost" icon={<PlayCircle className="h-4 w-4" />} onClick={() => rec.start("sample")}>
                Try with sample audio
              </Button>
            ) : null}
          </div>

          {blocked && (
            <div className="mt-2 text-left">
              <Notice tone="danger" icon={<ShieldAlert className="h-4 w-4" />} title="Recording needs a secure https:// address">
                This page was opened over plain http://, so the browser blocks the microphone. On a phone, open the
                app&apos;s https link instead (see “Testing on a phone” in the README).
              </Notice>
            </div>
          )}
          {busy && rec.noSound && (
            <div className="mt-2 text-left">
              <NoSoundNotice />
            </div>
          )}
        </div>

        <div className="space-y-5 border-t border-border px-5 py-5">
          <div>
            <FieldLabel>Speech engine</FieldLabel>
            <OptionList
              label="Speech engine"
              value={engine}
              disabled={locked}
              onChange={(v) => {
                setEngine(v);
                remember(ENGINE_KEY, v);
              }}
              options={inApp ? ENGINES.map((e) => ({ ...e, description: APP_ENGINE_NOTES[e.value] })) : ENGINES}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <FieldLabel htmlFor="rec-language">Language</FieldLabel>
              {engine === "moonshine" ? (
                <select id="rec-language" disabled className={selectCls}>
                  <option>English</option>
                </select>
              ) : (
                <select
                  id="rec-language"
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
            </div>
            <div>
              <FieldLabel htmlFor="rec-mic">Microphone</FieldLabel>
              {nativeMode && (
                <select disabled className={selectCls}>
                  <option>Phone microphone</option>
                </select>
              )}
              <select
                id="rec-mic"
                hidden={nativeMode}
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
            </div>
          </div>

          {canCaptureSystem && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3 hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <MonitorSpeaker className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-ui font-medium">Also capture tab audio</span>
                <span className="block text-meta text-muted-foreground">For Zoom, Meet or Teams in this browser</span>
              </span>
              <input
                type="checkbox"
                checked={captureSystemAudio}
                onChange={(e) => setCaptureSystemAudio(e.target.checked)}
                disabled={locked}
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
            </label>
          )}

          {nativeMode && battery.restricted && (
            <Notice icon={<BatteryWarning className="h-4 w-4 text-warning" />} title="Let long meetings run">
              <span className="block">
                Android may stop the app during a long recording to save battery. Set battery use to Unrestricted.
              </span>
              <Button className="mt-3" onClick={battery.fix}>Allow unrestricted battery</Button>
            </Notice>
          )}

          <p className="flex items-start gap-2 text-meta text-muted-foreground">
            <BatteryCharging className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {nativeMode
              ? "Keeps recording with the screen off or in another app. Plug in the charger for long meetings."
              : inApp
                ? "On-device engines need this screen on. Choose Cloud to record with the screen off."
                : "Long meetings record for as long as you need. Keep this screen on, and plug in the charger."}
          </p>
        </div>
      </Panel>

      {/* ---------- Transcript ---------- */}
      <Panel as="section" aria-label="Live transcript" className="flex flex-col lg:sticky lg:top-10 lg:h-[calc(100dvh-5rem)]">
        <PanelHeader
          title="Transcript"
          meta={
            <span className="inline-flex items-center gap-3">
              {hasTranscript && <span>{words.toLocaleString("en-IN")} words</span>}
              {saveStatus}
            </span>
          }
        >
          {busy && !rec.isPaused && <Badge tone="live"><LiveDot /> Live</Badge>}
          {busy && rec.isPaused && <Badge>Paused</Badge>}
        </PanelHeader>

        <div className="scroll-thin min-h-[45dvh] flex-1 px-4 py-5 sm:px-6 lg:overflow-y-auto">
          {busy && rec.noSound && (
            <div className="mb-4 lg:hidden">
              <NoSoundNotice />
            </div>
          )}
          {!hasTranscript && !hasLive ? (
            <div className="flex h-full min-h-[40dvh] flex-col items-center justify-center gap-2 text-center">
              <p className="text-ui font-medium">{busy ? "Listening…" : "No transcript yet"}</p>
              <p className="max-w-[36ch] text-meta text-muted-foreground">
                {busy
                  ? "Words appear here as people speak."
                  : "Start recording and the conversation appears here, saved to your account as you go."}
              </p>
            </div>
          ) : (
            <TranscriptView
              parts={rec.transcriptParts}
              interimText={rec.interimText}
              liveStatus={rec.liveStatus}
              backlog={rec.backlog}
              window="tail"
            />
          )}
          {/* scroll margin keeps the newest line clear of the phone controls when auto-scrolling */}
          <div ref={bottomRef} className="scroll-mb-48 lg:scroll-mb-6" />
        </div>

        {finished && (
          <div className="border-t border-border p-4 sm:px-6">
            <Link
              href={`/meeting?id=${rec.meetingId}`}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90"
            >
              Open meeting for minutes and export <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </Panel>

      {/* ---------- Phone recording bar (above the tab bar) ---------- */}
      {busy && <div className="h-16 lg:hidden" aria-hidden />}
      {busy && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+1px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-30 px-3 pb-2 lg:hidden">
          <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-panel border border-border bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className={cx("flex items-center gap-2 text-lg font-semibold tabular-nums", rec.isPaused && "text-muted-foreground")}>
                <LiveDot paused={rec.isPaused} />
                {formatDuration(rec.recordingSeconds)}
                {!rec.isPaused && <span className="ml-1"><LevelMeter level={rec.micLevel} bars={10} /></span>}
              </div>
              <p className="line-clamp-2 text-meta text-muted-foreground">{rec.statusMsg}</p>
            </div>
            <button
              onClick={rec.isPaused ? rec.resume : rec.pause}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-border bg-card active:scale-95"
              aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
            >
              {rec.isPaused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
            </button>
            <button
              onClick={rec.stop}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-danger text-white active:scale-95"
              aria-label="Stop recording"
            >
              <Square className="h-5 w-5 fill-current" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoSoundNotice() {
  return (
    <Notice tone="danger" icon={<MicOff className="h-4 w-4" />} title="No sound from the microphone">
      If the phone took over the mic (a call or another app), close it and tap Resume. Otherwise stop, pick another
      microphone and try again. On Windows, check Settings → System → Sound → Input.
    </Notice>
  );
}
