"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Mic, Square, Pause, Play, Cloud, CloudOff, Loader2, ArrowRight, PlayCircle, MicOff, Zap, Languages, Users,
  MonitorSpeaker, HardDrive, WifiOff, ShieldAlert, BatteryCharging, BatteryWarning, FileText, ChevronDown, ArrowDown,
} from "lucide-react";
import { useRecorder } from "@/hooks/useRecorder";
import { useBatteryRestriction, useNativeRecorder } from "@/hooks/useNativeRecorder";
import { isNativeApp } from "@/lib/nativeRecorder";
import { setWebRecording } from "@/lib/recordingFlag";
import { formatDuration } from "@/lib/transcript";
import { effectiveEngine, useFeatureGate } from "@/lib/featureGate";
import { WHISPER_LANGUAGES } from "@/lib/speech/models";
import type { RecordEngine } from "@/lib/speech/deepgram";
import { useConnectivity } from "@/lib/connectivity";
import { startGate } from "@/lib/speech/readiness";
import { OfflineModelControl, useOfflineReadiness, type OfflineReadiness } from "./OfflineModelControl";
import { TranscriptView } from "./TranscriptView";
import { Badge, Button, FieldLabel, LiveDot, GateReason, Notice, Panel, PanelHeader, Segmented, Switch, cx, selectCls } from "./ui";
import { Orb } from "./Orb";
import { Waveform } from "./Waveform";
import { useToast } from "./Toast";
import { calmMode, CALM_BOOST_MS } from "@/lib/calmMode";
import { useMotionPref } from "@/lib/motionPref";
import * as haptics from "@/lib/haptics";

const MIC_KEY = "transcriber.micId";
const ENGINE_KEY = "transcriber.engine";
const LANG_KEY = "transcriber.language";
const LAST_ON_DEVICE_KEY = "transcriber.lastOnDeviceEngine";

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

export function Recorder() {
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [canCaptureSystem, setCanCaptureSystem] = useState(false);
  const [micId, setMicId] = useState("");
  const { mics, refresh: refreshMics } = useMicrophones();
  /** The saved preference. Only ever written by the user's own selection. */
  const [engine, setEngine] = useState<RecordEngine>("moonshine");
  const [lastOnDevice, setLastOnDevice] = useState<RecordEngine>("moonshine");
  const [language, setLanguage] = useState("en");
  const deepgramGate = useFeatureGate("deepgram");
  // Once a recording is starting or running, the engine is frozen: connectivity flips never change it.
  const [sessionLocked, setSessionLocked] = useState(false);
  const computedEngine = effectiveEngine({
    saved: engine,
    lastOnDevice,
    locked: false,
    deepgramEnabled: deepgramGate.enabled,
  }) as RecordEngine;
  const conn = useConnectivity();
  const [modelStatus, setModelStatus] = useState<Record<string, OfflineReadiness>>({});
  const frozenEngine = useRef<RecordEngine>(computedEngine);
  if (!sessionLocked) frozenEngine.current = computedEngine;
  const effective: RecordEngine = sessionLocked ? frozenEngine.current : computedEngine;
  const overridden = effective !== engine;
  const onDevice = effective === "moonshine" || effective === "whisper" ? effective : null;
  const moonReady = useOfflineReadiness("moonshine").readiness?.status === "ready";
  const whisperReady = useOfflineReadiness("whisper").readiness?.status === "ready";
  const ready: Record<string, boolean> = { moonshine: moonReady, whisper: whisperReady };
  const cur = onDevice ? modelStatus[onDevice] : undefined;
  const gateStart = onDevice
    ? startGate({ preferredCached: cur?.preferredCached ?? false, ortCached: cur?.ortCached ?? false, conn })
    : { allowed: true as boolean, reason: undefined as string | undefined };
  const webRec = useRecorder({ captureSystemAudio, deviceId: micId, engine: effective, language });
  const nativeRec = useNativeRecorder({ language });
  // Android app: cloud mode records in a native service that keeps going with the screen off.
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isNativeApp()), []);
  const nativeMode = inApp && (effective === "deepgram" || nativeRec.isRecording || nativeRec.isStarting);
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
      const savedOnDevice = localStorage.getItem(LAST_ON_DEVICE_KEY);
      if (savedOnDevice === "moonshine" || savedOnDevice === "whisper") setLastOnDevice(savedOnDevice);
      else if (savedEngine === "moonshine" || savedEngine === "whisper") setLastOnDevice(savedEngine);
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

  const heroRef = useRef<HTMLElement>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastUserInput = useRef(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { pref, setPref, reduced } = useMotionPref();
  const toast = useToast();
  const [hidden, setHidden] = useState(false);
  const [lowBattery, setLowBattery] = useState(false);
  const [boostUntil, setBoostUntil] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Battery Status API is optional (not in every WebView). Read locally, never stored or sent.
  useEffect(() => {
    type Bat = EventTarget & { level: number; charging: boolean };
    let bat: Bat | null = null;
    let gone = false;
    const update = () => {
      if (bat) setLowBattery(bat.level <= 0.2 && !bat.charging);
    };
    try {
      const get = (navigator as unknown as { getBattery?: () => Promise<Bat> }).getBattery;
      get
        ?.call(navigator)
        .then((b) => {
          if (gone) return;
          bat = b;
          update();
          b.addEventListener("levelchange", update);
          b.addEventListener("chargingchange", update);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
    return () => {
      gone = true;
      bat?.removeEventListener("levelchange", update);
      bat?.removeEventListener("chargingchange", update);
    };
  }, []);

  // Re-render once when a tap-to-show-animation boost runs out.
  useEffect(() => {
    if (!boostUntil) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, boostUntil - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [boostUntil]);

  // Is the hero on screen? Phones show the floating bar only when it is not.
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Track the newest line: only a user scroll (touch/wheel/key within 1 s) turns off follow-live.
  useEffect(() => {
    const mark = () => {
      lastUserInput.current = Date.now();
    };
    window.addEventListener("touchstart", mark, { passive: true });
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("keydown", mark);
    const el = bottomRef.current;
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) setAtBottom(true);
        else if (Date.now() - lastUserInput.current < 1000) setAtBottom(false);
      });
      io.observe(el);
    }
    return () => {
      window.removeEventListener("touchstart", mark);
      window.removeEventListener("wheel", mark);
      window.removeEventListener("keydown", mark);
      io?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (rec.isRecording) setAtBottom(true);
  }, [rec.isRecording]);

  // On phones the page itself scrolls: keep the orb and stop button on screen until the user scrolls down.
  useEffect(() => {
    if (!rec.isRecording || !atBottom) return;
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    if (wide || !heroVisible) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rec.transcriptParts, rec.interimText, rec.liveStatus, rec.isRecording, atBottom, heroVisible]);

  useEffect(() => {
    if (rec.noSound) haptics.warn();
  }, [rec.noSound]);

  const prevSave = useRef(rec.saveState);
  useEffect(() => {
    const prev = prevSave.current;
    prevSave.current = rec.saveState;
    if (!rec.isRecording && rec.saveState === "saved" && (prev === "local" || prev === "error")) toast("Synced", "success");
  }, [rec.saveState, rec.isRecording, toast]);

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
  useEffect(() => setSessionLocked(locked), [locked]);
  /** Finished and fully saved: safe to open the meeting page. */
  const finished = !busy && !starting && !!rec.meetingId && hasTranscript && (rec.saveState === "saved" || rec.saveState === "local");
  // Memoised: recounting thousands of phrases on every mic-level update made long meetings sluggish.
  const words = useMemo(
    () => rec.transcriptParts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    [rec.transcriptParts]
  );

  const mode = calmMode({
    recording: busy,
    paused: rec.isPaused,
    seconds: rec.recordingSeconds,
    reduced,
    hidden,
    lowBattery,
    boostUntil,
    now: Date.now(),
  });
  const showBar = busy && !heroVisible;
  const selectedEngine = ENGINES.find((e) => e.value === effective);
  const onHeroClick = (e: React.MouseEvent) => {
    if (mode !== "calm") return;
    if ((e.target as HTMLElement).closest("button, a, select, input, label")) return;
    setBoostUntil(Date.now() + CALM_BOOST_MS);
  };

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
      <Panel as="section" aria-label="Recording controls" ref={heroRef} className="overflow-hidden lg:sticky lg:top-10">
        {finished && (
          // Phones: the transcript is below the fold after Stop, so offer the meeting up here.
          <Link
            href={`/meeting?id=${rec.meetingId}`}
            className="flex items-center gap-3 rounded-t-panel border-b border-border px-5 py-3.5 text-ui hover:bg-muted/50 lg:hidden"
          >
            <FileText className="h-4 w-4 shrink-0 text-success" />
            <span className="flex-1">
              <span className="block font-medium">Meeting saved</span>
              <span className="block text-meta text-muted-foreground">Open it for minutes and export</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}

        <div
          className="flex flex-col items-center px-6 py-8 text-center max-lg:min-h-[min(560px,70dvh)] max-lg:justify-center"
          onClick={onHeroClick}
        >
          <div className="flex items-center justify-center gap-2 text-[13px] font-semibold">
            {busy && <LiveDot paused={rec.isPaused} solid={mode === "calm" || mode === "reduced"} />}
            {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span
              className={cx(
                busy && !rec.isPaused && "text-record",
                busy && rec.isPaused && "text-warning",
                !busy && "text-muted-foreground",
                busy && !rec.isPaused && mode === "live" && "live-blink"
              )}
            >
              {stateLabel}
            </span>
          </div>
          <div
            className={cx(
              "mt-2 font-mono text-display font-normal tabular-nums tracking-[-0.02em]",
              busy || starting ? "text-foreground" : "text-muted-foreground/60"
            )}
          >
            {formatDuration(rec.recordingSeconds)}
          </div>

          <div className="relative mt-4 grid h-[280px] w-full place-items-center">
            <div className="absolute inset-0 grid place-items-center">
              <Orb level={rec.micLevel} mode={mode} />
            </div>
            {busy && (
              <button
                onClick={rec.isPaused ? rec.resume : rec.pause}
                className="slide-in-left absolute left-1/2 top-1/2 -ml-[124px] -mt-7 z-10 grid h-14 w-14 place-items-center rounded-full border border-border/70 bg-card shadow-card active:scale-95"
                aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
              >
                {rec.isPaused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
              </button>
            )}
            <button
              onClick={
                busy
                  ? () => {
                      haptics.stop();
                      rec.stop();
                    }
                  : starting || !gateStart.allowed
                    ? undefined
                    : () => {
                        haptics.start();
                        rec.start("mic");
                      }
              }
              disabled={!busy && (starting || blocked || !gateStart.allowed)}
              aria-disabled={!busy && (starting || blocked || !gateStart.allowed)}
              aria-describedby={!busy && !gateStart.allowed ? "start-gate-reason" : undefined}
              data-state={busy ? (rec.isPaused ? "paused" : "recording") : "idle"}
              style={{
                transition: "transform var(--dur-4) var(--spring), border-radius var(--dur-4) var(--spring)",
                transform: busy ? "scale(0.818)" : undefined,
                borderRadius: busy ? 22 : 44,
                boxShadow: "0 0 0 6px color-mix(in oklab, var(--record-fill) 20%, transparent)",
              }}
              className={cx(
                "relative z-10 grid h-22 w-22 place-items-center bg-record-fill text-white",
                !busy && "active:scale-95",
                "disabled:cursor-not-allowed",
                !busy && (blocked || !gateStart.allowed) && "opacity-40"
              )}
              aria-label={busy ? "Stop recording" : starting ? "Starting recording" : "Start recording"}
            >
              {busy && !rec.isPaused && mode === "live" && (
                <span aria-hidden className="live-ring pointer-events-none absolute inset-0 rounded-[inherit] bg-record-fill opacity-40" />
              )}
              {busy ? (
                <Square className="relative h-6 w-6 fill-current" />
              ) : starting ? (
                <Loader2 className="relative h-7 w-7 animate-spin" />
              ) : (
                <Mic className="relative h-7 w-7" />
              )}
            </button>
          </div>

          <div className="mt-2 flex h-12 w-full justify-center">
            {busy ? (
              <Waveform level={rec.isPaused ? 0 : rec.micLevel} reduced={mode !== "live"} />
            ) : (
              !starting && (
                <p className="self-center text-[13px] text-muted-foreground">
                  {onDevice && inApp ? "Tap to record · Works without internet on this phone" : "Tap to record"}
                </p>
              )
            )}
          </div>

          {mode === "calm" && (
            <p className="mt-2 text-[13px] text-muted-foreground">Calm mode saves battery. Tap to show the animation.</p>
          )}

          <p className="mx-auto mt-2 min-h-[1.25rem] max-w-[30ch] text-[13px] text-muted-foreground" aria-live="polite">
            {rec.statusMsg === "Ready" ? "" : rec.statusMsg}
          </p>

          <div className="mt-2 flex min-h-11 items-center justify-center">
            {starting ? (
              <Button variant="ghost" onClick={rec.cancelStart}>Cancel</Button>
            ) : !busy && !blocked && !nativeMode ? (
              <Button variant="ghost" icon={<PlayCircle className="h-4 w-4" />} onClick={() => rec.start("sample")}>
                Try with sample audio
              </Button>
            ) : null}
          </div>

          {!busy && !starting && <GateReason id="start-gate-reason" reason={gateStart.reason} />}
          {blocked && (
            <div className="mt-2 w-full text-left">
              <Notice tone="danger" icon={<ShieldAlert className="h-4 w-4" />} title="Recording needs a secure https:// address">
                This page was opened over plain http://, so the browser blocks the microphone. On a phone, open the
                app&apos;s https link instead (see “Testing on a phone” in the README).
              </Notice>
            </div>
          )}
          {busy && rec.noSound && (
            <div className="mt-2 w-full text-left" role="alert">
              <NoSoundNotice />
            </div>
          )}
        </div>

        <div className="space-y-5 border-t border-border/70 px-5 py-5">
          <div>
            <FieldLabel>Speech engine</FieldLabel>
            <Segmented<RecordEngine>
              label="Speech engine"
              value={effective}
              disabled={locked}
              onChange={(v) => {
                setEngine(v);
                remember(ENGINE_KEY, v);
                if (v !== "deepgram") {
                  setLastOnDevice(v);
                  remember(LAST_ON_DEVICE_KEY, v);
                }
              }}
              options={ENGINES.map((e) => ({
                value: e.value,
                label: e.title,
                icon: e.icon,
                disabled: e.value === "deepgram" && !deepgramGate.enabled,
              }))}
            />
            {selectedEngine && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{selectedEngine.aside}</span>
                {" · "}
                {inApp ? APP_ENGINE_NOTES[selectedEngine.value] : selectedEngine.description}
                {ready[effective] && <> <span className="text-success">Ready offline</span></>}
              </p>
            )}
            <GateReason reason={deepgramGate.enabled ? null : deepgramGate.reason} icon={<CloudOff className="h-3.5 w-3.5" />} />
            {onDevice && (
              <div className="mt-3">
                <OfflineModelControl
                  engine={onDevice}
                  disabled={locked}
                  onStatusChange={(r) =>
                    setModelStatus((m) => {
                      const o = m[onDevice];
                      return o && o.status === r.status && o.preferredCached === r.preferredCached && o.ortCached === r.ortCached
                        ? m
                        : { ...m, [onDevice]: r };
                    })
                  }
                />
              </div>
            )}
            {overridden && !locked && (
              <div className="mt-3">
                <Notice icon={<WifiOff className="h-4 w-4" />}>
                  Offline, using on-device. Your Cloud choice comes back when you&apos;re online.
                </Notice>
              </div>
            )}
          </div>

          {nativeMode && battery.restricted && (
            <Notice icon={<BatteryWarning className="h-4 w-4 text-warning" />} tone="warning" title="Let long meetings run">
              <span className="block">
                Android may stop the app during a long recording to save battery. Set battery use to Unrestricted.
              </span>
              <Button className="mt-3" onClick={battery.fix}>Allow unrestricted battery</Button>
            </Notice>
          )}

          <div>
            <Button
              variant="ghost"
              onClick={() => setOptionsOpen((o) => !o)}
              aria-expanded={optionsOpen}
              aria-controls="rec-options"
              icon={
                <ChevronDown
                  className="h-4 w-4"
                  style={{ transition: "transform var(--dur-2)", transform: optionsOpen ? "rotate(180deg)" : "none" }}
                />
              }
            >
              Options
            </Button>
            <div id="rec-options" hidden={!optionsOpen} className="mt-3 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <FieldLabel htmlFor="rec-language">Language</FieldLabel>
                  {effective === "moonshine" ? (
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
                <label className="flex cursor-pointer items-start gap-3 rounded-chip border border-border px-3.5 py-3 hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
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

              {effective !== "deepgram" ? (
                <Notice icon={<BatteryCharging className="h-4 w-4" />} title="Keep the screen on">
                  On-device recording works with no internet, but it stops if the screen locks. Keep this screen open while
                  you record.
                </Notice>
              ) : (
                <p className="flex items-start gap-2 text-meta text-muted-foreground">
                  <BatteryCharging className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {nativeMode
                    ? "Cloud keeps recording with the screen off, but it needs internet the whole time. Plug in the charger for long meetings."
                    : "Cloud keeps recording with the screen off, but it needs internet the whole time."}
                </p>
              )}

              <Switch
                label="Reduce motion"
                description="Fewer animations. Saves a little battery."
                checked={pref === "reduced"}
                onChange={(on) => setPref(on ? "reduced" : "auto")}
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* ---------- Transcript ---------- */}
      <Panel as="section" aria-label="Live transcript" className="relative flex flex-col lg:sticky lg:top-10 lg:h-[calc(100dvh-5rem)]">
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
          {busy && rec.isPaused && <Badge tone="warning">Paused</Badge>}
        </PanelHeader>

        <div className="scroll-thin min-h-[45dvh] flex-1 px-4 py-5 sm:px-6 lg:overflow-y-auto">
          {busy && rec.noSound && (
            <div className="mb-4 lg:hidden" role="alert">
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
              speakerNames={rec.speakerNames}
              speakerStatus={rec.speakerStatus}
              onRenameSpeaker={nativeMode ? undefined : webRec.renameSpeaker}
              renameHint={false}
              window="tail"
            />
          )}
          {/* scroll margin keeps the newest line clear of the phone controls when auto-scrolling */}
          <div ref={bottomRef} className="scroll-mb-48 lg:scroll-mb-6" />
        </div>

        {busy && !atBottom && (
          <div className="pointer-events-none sticky bottom-4 flex justify-center">
            <button
              onClick={() => {
                setAtBottom(true);
                bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
              }}
              className="pop-in pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-ui font-medium text-accent-foreground shadow-float"
            >
              <ArrowDown className="h-4 w-4" /> Jump to live
            </button>
          </div>
        )}

        {finished && (
          <div className="border-t border-border/70 p-4 sm:px-6">
            <Link
              href={`/meeting?id=${rec.meetingId}`}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90"
            >
              Open meeting for minutes and export <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </Panel>

      {/* ---------- Phone recording bar (above the floating tab bar) ---------- */}
      {showBar && <div className="h-16 lg:hidden" aria-hidden />}
      {showBar && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-30 flex justify-center px-3 lg:hidden">
          <div className="glass pointer-events-auto flex h-12 items-center gap-3 rounded-full px-3 shadow-float">
            <LiveDot paused={rec.isPaused} solid={mode !== "live"} />
            <span className={cx("font-mono text-ui font-semibold tabular-nums", rec.isPaused && "text-muted-foreground")}>
              {formatDuration(rec.recordingSeconds)}
            </span>
            <Waveform bars={10} height={20} level={rec.isPaused ? 0 : rec.micLevel} reduced={mode !== "live"} />
            <button
              onClick={rec.isPaused ? rec.resume : rec.pause}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card/70 active:scale-95"
              aria-label={rec.isPaused ? "Resume recording" : "Pause recording"}
            >
              {rec.isPaused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
            </button>
            <button
              onClick={() => {
                haptics.stop();
                rec.stop();
              }}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-record-fill text-white active:scale-95"
              aria-label="Stop recording"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoSoundNotice() {
  return (
    <Notice tone="warning" icon={<MicOff className="h-4 w-4" />} title="No sound from the microphone">
      If the phone took over the mic (a call or another app), close it and tap Resume. Otherwise stop, pick another
      microphone and try again. On Windows, check Settings → System → Sound → Input.
    </Notice>
  );
}
