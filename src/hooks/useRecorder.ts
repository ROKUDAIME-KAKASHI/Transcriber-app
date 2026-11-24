"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";
import {
  drainEmbeddings, loadSpeakerModel, loadSpeechModel, onEmbedding, pendingEmbeds, transcribeFinal, transcribePartial,
  type EmbeddingEvent,
} from "@/lib/speech/client";
import {
  assignOnline, compactLabels, createOnline, mapToLive, refine, remapNames,
  type OnlineState, type SpeakerStatus,
} from "@/lib/speech/diarize";
import type { ModelName } from "@/lib/speech/models";
import { VoiceChunker } from "@/lib/speech/voiceChunker";
import { cleanPhrase } from "@/lib/speech/cleanText";
import {
  createLocal, getEmbeddings, getMeta, getParts, purge, putEmbeddings, putParts, releaseStaleNativeClaims, setSpeakerNames, touchRecording,
} from "@/lib/local/repo";
import { MeetingRecorder, isNativeApp, nativeCapabilities, type NativeReadAudioResult } from "@/lib/nativeRecorder";
import {
  RateMeter, committedCursor, frameBlock, isCatchingUp, pcm16Base64ToFloat32, readSizeFor, NATIVE_SAMPLE_RATE,
} from "@/lib/speech/nativeFeed";
import {
  finishingLine, nativeStatusLine, pickCapture, recoveryNote, resumeFrom, storageNotice, type CaptureInfoLite, type NativeRowInfo,
} from "@/lib/speech/nativeSession";
import { newMeetingId } from "@/lib/local/ids";
import { flush, markRecording, onRemoteStop, poke, type FlushResult } from "@/lib/local/sync";
import { isStoppedReply } from "@/lib/recordingState";
import { useLocalUser } from "@/components/SyncProvider";
import { useMeetingSync } from "@/hooks/useSync";
import {
  DEEPGRAM_SAMPLE_RATE, deepgramUrl, fetchDeepgramToken, floatToPcm16, speakerRuns,
  type DeepgramMessage, type RecordEngine,
} from "@/lib/speech/deepgram";

const AUTOSAVE_MS = 5000;

/**
 * Deepgram: after an unexpected drop the recorder keeps reconnecting for as long as the meeting
 * runs (a 10-hour meeting will see Wi-Fi blips; it must never end on its own), waiting longer
 * between tries up to RECONNECT_MAX_DELAY_MS. Audio from the last MAX_QUEUED_SECONDS is held and
 * sent once the connection is back.
 */
const RECONNECT_MAX_DELAY_MS = 30_000;
const MAX_QUEUED_SECONDS = 60;
/** Deepgram closes idle sockets after ~10 s without audio (e.g. while paused). */
const KEEPALIVE_MS = 5000;
/** A speaker's bubble is closed after this many characters even without a pause. */
const MAX_BUBBLE_CHARS = 400;

/**
 * "Try with sample audio": a short public-domain speech clip (JFK, 1961) fed into the
 * recorder instead of the microphone, so transcription can be seen working without a mic
 * (e.g. in browsers or embedded views that block microphone access).
 */
const SAMPLE_AUDIO_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

export type AudioSource = "mic" | "sample";
export interface RecorderState {
  isRecording: boolean;
  /** Between the tap and recording actually running (mic prompt, model download, connecting). */
  isStarting: boolean;
  meetingId: string | null;
  transcriptParts: TranscriptPart[];
  /** Words heard but not final yet (live preview). */
  interimText: string;
  /** Activity, shown as a typing indicator when there's no live text yet. */
  liveStatus: "listening" | "transcribing" | null;
  /** Finished phrases still waiting to be transcribed (slow devices). */
  backlog: number;
  /** Mic loudness 0–1 for the level meter. */
  micLevel: number;
  /** True when the mic has delivered (near) silence for several seconds. */
  noSound: boolean;
  recordingSeconds: number;
  /** Recording is on hold (mic open, nothing transcribed, clock stopped). */
  isPaused: boolean;
  statusMsg: string;
  /** "saved" = synced to the server, "local" = safe on this device, upload pending. */
  saveState: "idle" | "saving" | "saved" | "local" | "error";
  /** Why a "local" save has not reached the server yet. */
  syncNote?: string | null;
  /** The meeting was stopped from another device (Meetings list) while this one was recording. */
  stoppedRemotely?: boolean;
  /** Names given to speakers (index as string -> name), live during on-device recording. */
  speakerNames: Record<string, string> | null;
  /** On-device speaker identification activity, for the transcript hint. */
  speakerStatus: SpeakerStatus;
  /** Offline capture: Stop was tapped and the phone is still turning the recorded audio into text. */
  finishing?: boolean;
  /** Offline capture: something the user should know about the phone (low or no storage). */
  notice?: { tone: "warning" | "danger"; text: string } | null;
}

/**
 * Live (word-by-word) previews per model. Each Whisper preview processes a full 30 s window,
 * so Whisper previews are rarer. (null would turn previews off for a model too slow for them.)
 */
const PREVIEW_INTERVAL_MS: Record<ModelName, number | null> = {
  "moonshine-base": 350,
  "moonshine-tiny": 350,
  "whisper-base": 1500,
};
const previewIntervalFor = (m: ModelName) => PREVIEW_INTERVAL_MS[m];

/** Below this RMS for NO_SOUND_MS the mic is treated as silent/wrong device. */
const NO_SOUND_RMS = 0.0004;
const NO_SOUND_MS = 5000;

/** No audio frames at all for this long (phone suspended the audio, mic track ended) counts as "no sound". */
const NO_FRAMES_MS = 3000;
/** After this many phrases in a row fail to transcribe, tell the user instead of silently dropping them. */
const MAX_FAILED_PHRASES = 3;

/** Thrown when the user cancels while recording is still starting. */
class StartCancelled extends Error {}

/**
 * A native (locked-screen) session keeps capturing when the Record screen is left. The screen that is
 * going away finishes its in-flight phrases and writes a last cursor; the next screen waits for that
 * before it reads the device store, so two instances never write over each other.
 */
let detachBarrier: Promise<void> | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** One finished phrase's embedding is waited for at most this long when catching up (a stuck worker must not stall Stop). */
const EMBED_DRAIN_MS = 120_000;
/** A native start that never reports "running" within this time is treated as failed. */
const NATIVE_START_GRACE_MS = 10_000;
/** Cursor is persisted on autosave when it moved at least this far past the stored one (keeps audio released during long silence). */
const CURSOR_PERSIST_SAMPLES = 10 * NATIVE_SAMPLE_RATE;

/**
 * Microphone settings for speech recognition.
 * Echo cancellation is off: on phones it switches the mic into "phone call" mode (band-limited,
 * gated, ducked audio that garbles words), and in meetings it would also cancel the other side's
 * voice coming out of the speakers. Noise suppression is off for the same reason. Auto gain is
 * only on for Deepgram: the on-device path already normalises each phrase's loudness itself.
 */
function micConstraints(engine: RecordEngine, deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: engine === "deepgram",
  };
}

/** rms → 0–1 on a −60 dB…0 dB scale, so quiet mics still move the meter. */
function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

export function useRecorder(opts: {
  captureSystemAudio: boolean;
  /** "moonshine" (fast, English), "whisper" (accents, Hindi) or "deepgram" (cloud, speaker labels). */
  engine: RecordEngine;
  /** Whisper and Deepgram: "en", "hi" or "auto". */
  language: string;
  /** Microphone to use (from enumerateDevices); empty = browser default. */
  deviceId?: string;
}) {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    isStarting: false,
    meetingId: null,
    transcriptParts: [],
    interimText: "",
    liveStatus: null,
    backlog: 0,
    micLevel: 0,
    noSound: false,
    recordingSeconds: 0,
    isPaused: false,
    statusMsg: "Ready",
    saveState: "idle",
    syncNote: null,
    speakerNames: null,
    speakerStatus: null,
  });

  const { userId, available } = useLocalUser();
  const localUserRef = useRef<{ userId: string | null; available: boolean }>({ userId, available });
  localUserRef.current = { userId, available };
  /** This recording lives in the device store first; the sync engine is the only server writer. */
  const localModeRef = useRef(false);
  const [localMode, setLocalMode] = useState(false);
  const serverRowRef = useRef(false);
  const flushResultRef = useRef<FlushResult | null>(null);
  const startIdRef = useRef<string | null>(null);

  // Mutable refs for things callbacks need without re-rendering.
  const partsRef = useRef<TranscriptPart[]>([]);
  const secondsRef = useRef(0);
  // Wall-clock timing. Counting setInterval ticks undercounts in background tabs (Chrome throttles
  // timers while you're in the Zoom tab), so elapsed time is computed from timestamps instead.
  const startedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const meetingIdRef = useRef<string | null>(null);
  const wantRecordingRef = useRef(false);

  const streamsRef = useRef<MediaStream[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On-device transcription (Moonshine)
  const chunkerRef = useRef<VoiceChunker | null>(null);
  const moonCtxRef = useRef<AudioContext | null>(null);
  const pendingSegmentsRef = useRef<Set<Promise<void>>>(new Set());
  const speakingRef = useRef(false);
  /** Live (not yet final) text per phrase id, shown greyed until the final version lands. */
  const previewsRef = useRef<Map<number, string>>(new Map());
  const lastEmittedPhraseRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Minimum gap between live previews for the loaded model, or null for no live previews. */
  const previewIntervalRef = useRef<number | null>(PREVIEW_INTERVAL_MS["moonshine-base"]);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  // Level meter / no-sound detection
  const lastLevelPaintRef = useRef(0);
  const quietSinceRef = useRef<number | null>(null);
  const noSoundRef = useRef(false);
  /** When the last audio frame arrived (watchdog for audio the phone silently suspended). */
  const lastFrameAtRef = useRef(0);
  const failedPhrasesRef = useRef(0);
  /** Each start() gets a token; cancelling or a newer start makes the old one bail out. */
  const startTokenRef = useRef(0);
  const startingRef = useRef(false);
  /** Parts the server has confirmed; autosave sends only the rest. */
  const savedPartsRef = useRef(0);
  const savingRef = useRef<Promise<boolean> | null>(null);

  // Deepgram (cloud)
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectsRef = useRef(0);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 16 kHz samples recorded so far (pauses excluded): the meeting clock for Deepgram. */
  const heardRef = useRef(0);
  /** Meeting time (in samples) where the current socket's audio starts; Deepgram times restart at 0 per socket. */
  const socketOffsetRef = useRef(0);
  /** Audio recorded while (re)connecting, sent once the socket opens. */
  const queueRef = useRef<ArrayBuffer[]>([]);
  const queueStartRef = useRef(0);
  /** The last bubble can still grow (same speaker, no pause since). */
  const openBubbleRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  // Native (locked-screen) session: the Android service records to files, this page transcribes them.
  /** This session's audio comes from the Android service (mode "local"), not from getUserMedia. */
  const nativeRef = useRef(false);
  /** Next sample to read from the service (absolute, 16 kHz, pauses excluded). */
  const readPosRef = useRef(0);
  /** Samples the service has flushed to disk (last value it reported). */
  const headRef = useRef(0);
  const pumpAliveRef = useRef(false);
  const pumpRef = useRef<Promise<void> | null>(null);
  /** The service has stopped and every sample was read. */
  const nativeDrainedRef = useRef(false);
  /** A read kept failing: do not mark the meeting finished, the audio stays on the phone. */
  const nativeFailedRef = useRef(false);
  const stoppingRef = useRef(false);
  const finalizingRef = useRef(false);
  const catchingUpRef = useRef(false);
  const rateRef = useRef(new RateMeter());
  /** Phrases sent to the worker whose text is not stored yet: job id -> first sample. */
  const inFlightRef = useRef<Map<number, number>>(new Map());
  const persistedCursorRef = useRef(0);
  const releasedRef = useRef(0);
  const sessionEngineRef = useRef<RecordEngine | null>(null);
  const nativeStartedAtRef = useRef(0);
  const sawActiveRef = useRef(false);
  const nativeTickBusyRef = useRef(false);
  const resumeTriedRef = useRef(false);
  /** Last pause/resume tap on a native session, shown until the service confirms it. */
  const nativePauseTapRef = useRef<{ at: number; value: boolean } | null>(null);
  /** The final write that clears nativeCapture succeeded (so the audio may be deleted). */
  const nativeFinishedRef = useRef(false);
  /** Shown in front of the "Finishing transcription" line (e.g. why a recovered recording stopped). */
  const finishNoteRef = useRef<string | null>(null);
  /** The server said this meeting was stopped elsewhere: finish the same way as the Stop button. */
  const handleRemoteStop = () => {
    if (!wantRecordingRef.current) return; // already stopping (our own Stop also ends in DONE)
    patch({ stoppedRemotely: true });
    void stopRef.current();
  };
  const handleRemoteStopRef = useRef(handleRemoteStop);
  handleRemoteStopRef.current = handleRemoteStop;
  useEffect(
    () =>
      onRemoteStop((id) => {
        if (id === meetingIdRef.current) handleRemoteStopRef.current();
      }),
    [],
  );

  // On-device speaker separation (additive; every use is wrapped so failures stay silent)
  const diarizeOnRef = useRef(false);
  const onlineRef = useRef<OnlineState | null>(null);
  const jobToPartRef = useRef<Map<number, number>>(new Map());
  const earlyVecRef = useRef<Map<number, EmbeddingEvent>>(new Map());
  const vectorsRef = useRef<Map<number, Float32Array>>(new Map());
  /** Part indexes whose embedding was requested and has not resolved yet. */
  const awaitingPartsRef = useRef<Set<number>>(new Set());
  /** Job ids that requested an embedding and have no resolution yet. */
  const awaitingJobsRef = useRef<Set<number>>(new Set());
  const embedBufferRef = useRef<{ part: number; vec: Float32Array; dur: number }[]>([]);
  const phraseSecRef = useRef<Map<number, number>>(new Map());
  const lastSkipAtRef = useRef(0);
  const unsubEmbedRef = useRef<(() => void) | null>(null);
  const speakerNamesRef = useRef<Record<string, string> | null>(null);
  const relabelNamesRef = useRef<Record<string, string> | null>(null);
  const relabelDoneRef = useRef(false);
  /** Refined names waiting to be written together with the refined parts (one IndexedDB transaction). */
  const pendingRelabelRef = useRef<{ names: Record<string, string> | null } | null>(null);

  const patch = (p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p }));

  // ---- Persistence -------------------------------------------------------
  /**
   * Saves the transcript so far. `closing` is for the page being closed: it uses keepalive so the
   * request outlives the page. Browsers cap keepalive bodies at 64 KB, so it must NOT be used for
   * normal saves — once a meeting passed ~64 KB of text every save failed ("Offline — will retry"
   * forever) and the transcript never reached the server.
   */
  const saveToServer = async (id: string, status?: "DONE", closing = false): Promise<boolean> => {
    {
      dirtyRef.current = false;
      patch({ saveState: "saving" });
      for (let attempt = 0; attempt < 2; attempt++) {
        // Only what changed since the last confirmed save (the last phrase can still grow: resend it).
        const parts = partsRef.current;
        const from = Math.max(0, Math.min(savedPartsRef.current - 1, parts.length));
        const body = JSON.stringify({
          transcriptTail: { from, parts: parts.slice(from) },
          durationSec: secondsRef.current,
          ...(status ? { status } : {}),
        });
        try {
          const res = await fetch(`/api/meetings/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: closing && body.length < 60_000,
          });
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 && typeof data.savedParts === "number") {
            savedPartsRef.current = data.savedParts; // server has less than we thought: resend from there
            continue;
          }
          if (!res.ok) throw new Error();
          savedPartsRef.current = typeof data.savedParts === "number" ? data.savedParts : parts.length;
          patch({ saveState: "saved" });
          if (isStoppedReply(data) && !status) handleRemoteStop();
          return true;
        } catch {
          break;
        }
      }
      dirtyRef.current = true; // retry on next tick
      patch({ saveState: "error" });
      return false;
    }
  };

  /** Device-first save: write to IndexedDB, then let the sync engine upload. Falls back to the server path if the write fails. */
  const saveLocal = async (id: string, status?: "DONE", closing = false): Promise<boolean> => {
    const uid = localUserRef.current.userId;
    dirtyRef.current = false;
    const relabel = pendingRelabelRef.current ?? undefined;
    // Native session: the cursor goes into the same transaction as the parts it covers.
    const finishing = status === "DONE" && nativeDrainedRef.current;
    const cursor = nativeRef.current ? (finishing ? headRef.current : computeCommitted()) : null;
    const native = cursor === null ? undefined : { nativeCursor: cursor, finishNative: finishing };
    const ok = uid ? await putParts(uid, id, partsRef.current, secondsRef.current, status, relabel, native) : false;
    if (ok && relabel && pendingRelabelRef.current === relabel) pendingRelabelRef.current = null;
    if (ok && cursor !== null) {
      if (finishing) nativeFinishedRef.current = true;
      persistedCursorRef.current = Math.max(persistedCursorRef.current, cursor);
      // Only now that the text is safe may the audio behind it go.
      if (cursor > releasedRef.current) {
        releasedRef.current = cursor;
        MeetingRecorder.releaseAudio({ meetingId: id, before: cursor }).catch(() => {});
      }
    }
    if (!uid || !ok) return saveToServer(id, status, closing);
    // No keepalive tail PATCH here: the data is in IndexedDB and the engine uploads it (a stale
    // fire-and-forget PATCH could truncate the server transcript).
    if (status === "DONE") flushResultRef.current = await flush(id, { timeoutMs: 15000 });
    else poke(id);
    const meta = await getMeta(uid, id);
    if (meta) {
      savedPartsRef.current = meta.savedParts;
      serverRowRef.current = !meta.dirty.create;
    }
    return true;
  };

  const save = useCallback(async (status?: "DONE", closing = false): Promise<boolean> => {
    const id = meetingIdRef.current;
    if (!id || (!dirtyRef.current && !status)) return true;
    // One save at a time: on a slow connection an older save finishing after a newer one used to
    // overwrite fresh text. If one is in flight, wait for it (final/closing saves) or skip (autosave).
    if (savingRef.current) {
      if (!status && !closing) return false;
      await savingRef.current.catch(() => {});
    }
    const run = localModeRef.current ? saveLocal(id, status, closing) : saveToServer(id, status, closing);
    savingRef.current = run;
    try {
      return await run;
    } finally {
      if (savingRef.current === run) savingRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In local mode the badge follows the meeting's sync state instead of each request.
  const meetingSync = useMeetingSync(localMode ? state.meetingId : null);
  useEffect(() => {
    if (!localMode) return;
    if (meetingSync === "synced") patch({ saveState: "saved", syncNote: null });
    else if (meetingSync === "saving") patch({ saveState: "saving", syncNote: null });
    else if (meetingSync === "waiting") patch({ saveState: "local", syncNote: "Waiting for internet" });
    else if (meetingSync === "needs-auth") patch({ saveState: "local", syncNote: "Sign in to sync" });
    else if (meetingSync === "conflict") patch({ saveState: "local", syncNote: "Couldn't sync" });
  }, [meetingSync, localMode]);

  /** Adds a finished phrase to the transcript, as its own chat bubble. */
  const appendFinal = (text: string, whisper: boolean, startSec: number) => {
    const clean = cleanPhrase(text, { whisper });
    if (!clean) return -1;
    const prev = partsRef.current[partsRef.current.length - 1];
    const speaker = diarizeOnRef.current && prev ? prev.speaker : 0;
    partsRef.current = [...partsRef.current, { speaker, text: clean, t: Math.round(startSec * 10) / 10 }];
    dirtyRef.current = true;
    patch({ transcriptParts: partsRef.current, interimText: "" });
    return partsRef.current.length - 1;
  };

  // ---- On-device speaker separation ------------------------------------------
  const updateSpeakerStatus = () => {
    try {
      if (!diarizeOnRef.current) return;
      const next: SpeakerStatus =
        lastSkipAtRef.current > 0 && Date.now() - lastSkipAtRef.current < 15_000
          ? "catching-up"
          : pendingEmbeds() > 0
            ? "identifying"
            : null;
      setState((s) => (s.speakerStatus === "refining" || s.speakerStatus === next ? s : { ...s, speakerStatus: next }));
    } catch {
      /* silent */
    }
  };

  const applyVector = (idx: number, vec: Float32Array) => {
    const online = onlineRef.current;
    if (!online) return;
    const k = assignOnline(online, vec);
    vectorsRef.current.set(idx, vec);
    const parts = partsRef.current;
    if (!parts[idx]) return;
    let next: TranscriptPart[] | null = null;
    if (parts[idx].speaker !== k) {
      next = parts.slice();
      next[idx] = { ...parts[idx], speaker: k };
    }
    // Phrases with no vector of their own (short/skipped) follow the speaker of the one before them.
    for (let j = idx + 1; j < parts.length; j++) {
      if (vectorsRef.current.has(j) || awaitingPartsRef.current.has(j)) break;
      if (parts[j].speaker !== k) {
        next ??= parts.slice();
        next[j] = { ...parts[j], speaker: k };
      }
    }
    if (next) {
      partsRef.current = next;
      dirtyRef.current = true;
      patch({ transcriptParts: next });
    }
  };

  const handleEmbedding = (e: EmbeddingEvent) => {
    try {
      if (!diarizeOnRef.current || !onlineRef.current) return;
      if (e.skipped === "backlog" || e.skipped === "slow" || e.skipped === "queue") lastSkipAtRef.current = Date.now();
      const idx = jobToPartRef.current.get(e.id);
      if (idx === undefined) {
        if (awaitingJobsRef.current.has(e.id)) earlyVecRef.current.set(e.id, e); // part index not known yet
        return;
      }
      awaitingPartsRef.current.delete(idx);
      awaitingJobsRef.current.delete(e.id);
      if (e.vector) {
        applyVector(idx, e.vector);
        embedBufferRef.current.push({ part: idx, vec: e.vector, dur: phraseSecRef.current.get(e.id) ?? 0 });
        if (embedBufferRef.current.length >= 10) flushEmbedBuffer();
      }
      phraseSecRef.current.delete(e.id);
      updateSpeakerStatus();
    } catch {
      /* silent: transcription carries on */
    }
  };

  const mapJob = (id: number, idx: number) => {
    try {
      const early = earlyVecRef.current.get(id);
      earlyVecRef.current.delete(id);
      if (idx < 0) {
        awaitingJobsRef.current.delete(id);
        phraseSecRef.current.delete(id);
        return;
      }
      jobToPartRef.current.set(id, idx);
      if (awaitingJobsRef.current.has(id)) awaitingPartsRef.current.add(idx);
      if (early) handleEmbedding(early);
    } catch {
      /* silent */
    }
  };

  const flushEmbedBuffer = () => {
    const uid = localUserRef.current.userId;
    const id = meetingIdRef.current;
    if (!localModeRef.current || !uid || !id || embedBufferRef.current.length === 0) return;
    const rows = embedBufferRef.current;
    embedBufferRef.current = [];
    const restore = () => { embedBufferRef.current = [...rows, ...embedBufferRef.current]; };
    putEmbeddings(uid, id, rows).then((ok) => { if (!ok) restore(); }).catch(restore);
  };

  const resetDiarization = () => {
    try { unsubEmbedRef.current?.(); } catch { /* silent */ }
    unsubEmbedRef.current = null;
    diarizeOnRef.current = false;
    onlineRef.current = null;
    jobToPartRef.current.clear();
    earlyVecRef.current.clear();
    vectorsRef.current.clear();
    awaitingPartsRef.current.clear();
    awaitingJobsRef.current.clear();
    embedBufferRef.current = [];
    phraseSecRef.current.clear();
    lastSkipAtRef.current = 0;
    speakerNamesRef.current = null;
    relabelNamesRef.current = null;
    relabelDoneRef.current = false;
    pendingRelabelRef.current = null;
  };

  /** Stop-time: drain queued embeddings, re-cluster everything, keep names on the same people. */
  const refineSpeakers = async () => {
    if (!diarizeOnRef.current) return;
    try {
      patch({ speakerStatus: "refining" });
      await drainEmbeddings(10_000);
      try { unsubEmbedRef.current?.(); } catch { /* silent */ }
      unsubEmbedRef.current = null;
      for (const [jobId, ev] of [...earlyVecRef.current]) {
        if (jobToPartRef.current.has(jobId)) handleEmbedding(ev);
      }
      if (vectorsRef.current.size >= 1) {
        await new Promise((r) => setTimeout(r, 0)); // let "refining" paint
        const parts = partsRef.current;
        const live = parts.map((p) => p.speaker);
        const vectors = parts.map((_, i) => vectorsRef.current.get(i) ?? null);
        const final = compactLabels(mapToLive(refine(vectors, { live }), live));
        const names = remapNames(speakerNamesRef.current, live, final);
        if (final.some((l, i) => l !== live[i])) {
          partsRef.current = parts.map((p, i) => (p.speaker === final[i] ? p : { ...p, speaker: final[i] }));
          dirtyRef.current = true;
          patch({ transcriptParts: partsRef.current });
        }
        const hadNames = !!speakerNamesRef.current && Object.keys(speakerNamesRef.current).length > 0;
        const hasNames = Object.keys(names).length > 0;
        const uid = localUserRef.current.userId;
        const id = meetingIdRef.current;
        if (localModeRef.current && uid && id) {
          flushEmbedBuffer();
          // Written with the refined parts by the next putParts, so a sync pass never sees new names on old parts.
          pendingRelabelRef.current = { names: hasNames ? names : hadNames ? {} : null };
        }
        speakerNamesRef.current = hasNames ? names : hadNames ? {} : null;
        relabelNamesRef.current = hasNames ? names : null;
        relabelDoneRef.current = true;
        patch({ speakerNames: speakerNamesRef.current });
      }
    } catch (err) {
      console.warn("Speaker refinement skipped:", err);
    } finally {
      patch({ speakerStatus: null });
    }
  };

  /** Rename a speaker during (or right after) recording. */
  const renameSpeaker = async (n: number, raw: string): Promise<boolean> => {
    const name = raw.trim().slice(0, 40);
    const next = { ...(speakerNamesRef.current ?? {}) };
    if (name) next[String(n)] = name;
    else delete next[String(n)];
    speakerNamesRef.current = next;
    patch({ speakerNames: next });
    const id = meetingIdRef.current;
    if (!id) return true;
    try {
      const uid = localUserRef.current.userId;
      if (localModeRef.current && uid) {
        const ok = await setSpeakerNames(uid, id, next);
        poke(id);
        return ok;
      }
      const res = await fetch(`/api/meetings/${id}/speakers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerNames: next }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // ---- Screen wake lock (phones kill the mic when the screen sleeps) -----
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* not supported or denied — recording still works while the screen is on */
    }
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && wantRecordingRef.current) acquireWakeLock();
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [save]);

  // ---- On-device transcription ---------------------------------------------
  const showMoonshineActivity = () => {
    const waiting = pendingSegmentsRef.current.size;
    const live = [...previewsRef.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t)
      .join(" ");
    patch({
      interimText: live,
      liveStatus: speakingRef.current ? "listening" : waiting ? "transcribing" : null,
      // On slow phones phrases can queue up; the UI says so instead of looking frozen.
      backlog: waiting,
    });
    updateSpeakerStatus();
  };

  /** Level meter + "is the mic actually delivering sound?" check. */
  const onMicLevel = (rms: number) => {
    const now = performance.now();
    lastFrameAtRef.current = now;
    if (rms < NO_SOUND_RMS) {
      quietSinceRef.current ??= now;
      if (!noSoundRef.current && now - quietSinceRef.current > NO_SOUND_MS) {
        noSoundRef.current = true;
        patch({ noSound: true });
      }
    } else {
      quietSinceRef.current = null;
      if (noSoundRef.current) {
        noSoundRef.current = false;
        patch({ noSound: false });
      }
    }
    // ~12 repaints a second is plenty for a meter.
    if (now - lastLevelPaintRef.current > 80) {
      lastLevelPaintRef.current = now;
      patch({ micLevel: levelFromRms(rms) });
    }
  };

  /**
   * Word-by-word preview: while someone is talking, re-transcribe the phrase so far and show it live.
   * Paced by how long the last preview took, so slower phones refresh less often and keep their
   * CPU for finishing phrases. Previews pause entirely while finished phrases are waiting.
   */
  const previewTick = async () => {
    const chunker = chunkerRef.current;
    const minInterval = previewIntervalRef.current;
    if (!chunker || !wantRecordingRef.current || minInterval === null) return;
    // Catching up on audio recorded earlier: every bit of CPU goes to the finished phrases.
    if (catchingUpRef.current) {
      previewTimerRef.current = setTimeout(previewTick, 1000);
      return;
    }
    let delay = minInterval;
    const snap = pendingSegmentsRef.current.size === 0 ? chunker.peek() : null;
    if (snap) {
      const t0 = performance.now();
      const text = await transcribePartial(snap.audio).catch(() => null);
      delay = Math.max(minInterval, (performance.now() - t0) * 1.5);
      // The last word of a live preview is usually cut off mid-syllable and misheard
      // (e.g. half of "country"), so hold it back; the final transcript has every word.
      const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
      const stable = words.slice(0, -1).join(" ").replace(/[.,!?;:]+$/, "");
      // Ignore previews that arrive after their phrase was already finalised.
      if (stable && snap.phraseId > lastEmittedPhraseRef.current) {
        previewsRef.current.set(snap.phraseId, `${stable} …`);
        showMoonshineActivity();
      }
    }
    if (chunkerRef.current === chunker) previewTimerRef.current = setTimeout(previewTick, delay);
  };

  /** A finished phrase from the chunker (microphone or native audio): transcribe it and add it to the transcript. */
  const onPhrase = (audio: Float32Array, phraseId: number, startSec: number, firstSample: number) => {
    lastEmittedPhraseRef.current = phraseId;
    // Read the length before the call: the buffer is transferred to the worker.
    const wantEmbed = diarizeOnRef.current && audio.length >= 16000;
    const phraseSec = audio.length / 16000;
    const { id: jobId, text: textP } = transcribeFinal(audio, { embed: wantEmbed, batch: nativeRef.current && catchingUpRef.current });
    // Native session: this phrase holds the committed cursor back until its text is stored.
    if (nativeRef.current) inFlightRef.current.set(jobId, firstSample);
    if (wantEmbed) {
      phraseSecRef.current.set(jobId, phraseSec);
      awaitingJobsRef.current.add(jobId);
    }
    const job = textP
      .then((text) => {
        failedPhrasesRef.current = 0;
        const idx = appendFinal(text, (sessionEngineRef.current ?? opts.engine) === "whisper", startSec); // one chat bubble per phrase
        if (diarizeOnRef.current) mapJob(jobId, idx);
      })
      .catch((err) => {
        console.error("On-device transcription error:", err);
        failedPhrasesRef.current += 1;
        if (failedPhrasesRef.current === MAX_FAILED_PHRASES) {
          patch({
            statusMsg:
              "This device is struggling to run the speech model (phrases are being lost). Stop, then try the Fast or Cloud engine.",
          });
        }
      })
      .finally(() => {
        inFlightRef.current.delete(jobId);
        // A failed transcription never maps: forget its pending embedding.
        if (diarizeOnRef.current && !jobToPartRef.current.has(jobId)) {
          awaitingJobsRef.current.delete(jobId);
          earlyVecRef.current.delete(jobId);
        }
        // The live preview for this phrase stays visible until its final text replaces it.
        previewsRef.current.delete(phraseId);
        pendingSegmentsRef.current.delete(job);
        showMoonshineActivity();
      });
    pendingSegmentsRef.current.add(job);
    showMoonshineActivity();
  };

  const startMoonshine = async () => {
    const ctx = moonCtxRef.current;
    const recordStream = recordStreamRef.current;
    if (!ctx || !recordStream) return;
    previewsRef.current.clear();
    lastEmittedPhraseRef.current = 0;
    quietSinceRef.current = null;
    noSoundRef.current = false;

    const chunker = new VoiceChunker(ctx, {
      onLevel: onMicLevel,
      onSpeechChange: (speaking) => {
        speakingRef.current = speaking;
        showMoonshineActivity();
      },
      onSegment: (audio, phraseId, startSec, firstSample) => onPhrase(audio, phraseId, startSec, firstSample),
    });
    await chunker.start(recordStream);
    chunkerRef.current = chunker;
    if (previewIntervalRef.current !== null) previewTimerRef.current = setTimeout(previewTick, previewIntervalRef.current);
    patch({ statusMsg: "Recording…", isRecording: true });
  };

  // ---- Deepgram (cloud) ----------------------------------------------------
  /** Adds a final Deepgram result: one bubble per speaker turn, growing until a pause. */
  const appendDeepgram = (msg: DeepgramMessage) => {
    const words = msg.channel?.alternatives?.[0]?.words ?? [];
    const offsetSec = socketOffsetRef.current / DEEPGRAM_SAMPLE_RATE;
    let parts = partsRef.current;
    for (const run of speakerRuns(words)) {
      const last = parts[parts.length - 1];
      if (openBubbleRef.current && last && last.speaker === run.speaker && last.text.length < MAX_BUBBLE_CHARS) {
        parts = [...parts.slice(0, -1), { ...last, text: `${last.text} ${run.text}` }];
      } else {
        parts = [...parts, { speaker: run.speaker, text: run.text, t: Math.round((offsetSec + run.start) * 10) / 10 }];
      }
      openBubbleRef.current = true;
    }
    if (msg.speech_final) openBubbleRef.current = false;
    if (parts !== partsRef.current) {
      partsRef.current = parts;
      dirtyRef.current = true;
    }
    patch({ transcriptParts: partsRef.current, interimText: "", liveStatus: speakingRef.current ? "listening" : null });
  };

  const sendAudio = (samples: Float32Array) => {
    const pcm = floatToPcm16(samples);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(pcm);
    } else if (wantRecordingRef.current) {
      // Connecting or reconnecting: hold the audio (up to MAX_QUEUED_SECONDS) and send it on open.
      if (queueRef.current.length === 0) queueStartRef.current = heardRef.current;
      queueRef.current.push(pcm);
      const maxBytes = MAX_QUEUED_SECONDS * DEEPGRAM_SAMPLE_RATE * 2;
      let bytes = queueRef.current.reduce((n, b) => n + b.byteLength, 0);
      while (bytes > maxBytes && queueRef.current.length > 1) {
        const dropped = queueRef.current.shift()!;
        bytes -= dropped.byteLength;
        queueStartRef.current += dropped.byteLength / 2;
      }
    }
    heardRef.current += samples.length;
  };

  /** Opens a socket; resolves once it is open, rejects if it fails before that. */
  const openSocket = async (): Promise<void> => {
    const token = await fetchDeepgramToken();
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(deepgramUrl(opts.language), ["bearer", token]);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      let opened = false;
      let openedAt = 0;

      socket.onopen = () => {
        opened = true;
        openedAt = Date.now();
        openBubbleRef.current = false;
        // Deepgram's times start at 0 for each socket; map them onto the meeting clock.
        socketOffsetRef.current = queueRef.current.length ? queueStartRef.current : heardRef.current;
        for (const buf of queueRef.current) socket.send(buf);
        queueRef.current = [];
        resolve();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: DeepgramMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "UtteranceEnd") {
          openBubbleRef.current = false;
          return;
        }
        if (msg.type !== "Results") return;
        if (msg.is_final) {
          appendDeepgram(msg);
        } else {
          const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
          patch({ interimText: text, liveStatus: text ? null : speakingRef.current ? "listening" : null });
        }
      };

      socket.onerror = () => console.error("Deepgram WebSocket error");

      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!opened) {
          reject(new Error(`Could not connect to Deepgram (code ${event.code}).`));
          return;
        }
        if (!wantRecordingRef.current) return;
        // A connection that lasted a while earns a fresh set of retries; one that drops right after
        // opening doesn't (otherwise a socket that opens and dies at once would retry forever).
        if (Date.now() - openedAt > 30_000) reconnectsRef.current = 0;
        // Unexpected drop (network blip, Wi-Fi → mobile data): reconnect; audio queues meanwhile.
        const retry = async () => {
          while (wantRecordingRef.current) {
            reconnectsRef.current += 1;
            const delay = Math.min(RECONNECT_MAX_DELAY_MS, 1000 * 2 ** Math.min(reconnectsRef.current - 1, 5));
            patch({
              statusMsg: navigator.onLine
                ? "Connection lost — reconnecting… Recording continues; the last minute of audio is kept."
                : "No internet — waiting for it to come back. Recording continues.",
            });
            // Offline: wait for the network to return (or the backoff), whichever is first.
            await new Promise<void>((r) => {
              const t = setTimeout(done, delay);
              function done() {
                clearTimeout(t);
                window.removeEventListener("online", done);
                r();
              }
              window.addEventListener("online", done);
            });
            if (!wantRecordingRef.current) return;
            try {
              await openSocket();
              patch({ statusMsg: "Recording (cloud, speaker labels)…" });
              return;
            } catch {
              /* try again */
            }
          }
        };
        retry();
      };
    });
  };

  const startDeepgram = async () => {
    const ctx = moonCtxRef.current;
    const recordStream = recordStreamRef.current;
    if (!ctx || !recordStream) return;
    heardRef.current = 0;
    queueRef.current = [];
    reconnectsRef.current = 0;
    openBubbleRef.current = false;
    quietSinceRef.current = null;
    noSoundRef.current = false;

    // Start the mic graph first: audio queues (sendAudio) while the socket connects, so Deepgram
    // gets audio the moment it opens and doesn't drop an idle socket during slow phone setup.
    const chunker = new VoiceChunker(ctx, {
      onLevel: onMicLevel,
      onAudio: sendAudio,
      onSpeechChange: (speaking) => {
        speakingRef.current = speaking;
        setState((s) => (s.interimText ? s : { ...s, liveStatus: speaking ? "listening" : null }));
      },
      onSegment: () => {}, // Deepgram finds the phrases itself
    });
    await chunker.start(recordStream);
    chunkerRef.current = chunker;
    keepAliveRef.current = setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "KeepAlive" }));
    }, KEEPALIVE_MS);

    patch({ statusMsg: "Connecting to Deepgram…" });
    try {
      await openSocket();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        /code \d+/.test(msg)
          ? `${msg} Check the internet connection, and that a VPN or ad-blocker isn't blocking api.deepgram.com.`
          : msg
      );
    }
    patch({ statusMsg: "Recording (cloud, speaker labels)…", isRecording: true });
  };

  /** Asks Deepgram for the last words, then closes the socket (waits at most 3 s). */
  const closeDeepgram = async () => {
    const socket = socketRef.current;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      const closed = new Promise<void>((r) => socket.addEventListener("close", () => r(), { once: true }));
      socket.send(JSON.stringify({ type: "CloseStream" }));
      await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
    }
    socket.close();
    socketRef.current = null;
  };

  // ---- Start / stop ------------------------------------------------------
  const cleanupMedia = () => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
    queueRef.current = [];
    const sample = sampleAudioRef.current;
    if (sample) {
      sample.onended = null;
      sample.pause();
      URL.revokeObjectURL(sample.src);
      sampleAudioRef.current = null;
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    chunkerRef.current?.stop();
    chunkerRef.current = null;
    moonCtxRef.current?.close().catch(() => {});
    moonCtxRef.current = null;
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    recordStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    if (autosaveRef.current) clearInterval(autosaveRef.current);
  };

  /** Seconds recorded so far, not counting pauses. */
  const elapsedSeconds = () => {
    if (!startedAtRef.current) return 0;
    const pausedNow = pausedAtRef.current !== null ? Date.now() - pausedAtRef.current : 0;
    return Math.max(0, Math.floor((Date.now() - startedAtRef.current - pausedMsRef.current - pausedNow) / 1000));
  };

  const tick = () => {
    const s = elapsedSeconds();
    if (s !== secondsRef.current) {
      secondsRef.current = s;
      patch({ recordingSeconds: s });
    }
    // Watchdog: phones can suspend the audio (incoming call, Siri, screen lock, another app taking
    // the mic) without any error. No frames at all → warn and try to wake the audio up.
    if (wantRecordingRef.current && pausedAtRef.current === null && chunkerRef.current) {
      const silentFor = performance.now() - lastFrameAtRef.current;
      if (silentFor > NO_FRAMES_MS) {
        moonCtxRef.current?.resume().catch(() => {});
        if (!noSoundRef.current) {
          noSoundRef.current = true;
          patch({ noSound: true, micLevel: 0 });
        }
      }
    }
  };

  /** Breaks, side conversations: stop transcribing without ending the meeting. */
  const pause = () => {
    if (nativeRef.current) {
      if (wantRecordingRef.current && !stoppingRef.current) setNativePaused(true);
      return;
    }
    if (!wantRecordingRef.current || pausedAtRef.current !== null) return;
    chunkerRef.current?.pause(); // the phrase in progress is finished and kept
    // Deepgram: get the words heard so far now, instead of after the break. KeepAlive holds the socket.
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "Finalize" }));
    openBubbleRef.current = false;
    pausedAtRef.current = Date.now();
    patch({ isPaused: true, micLevel: 0, noSound: false, statusMsg: "Paused — nothing is being transcribed." });
    save();
  };

  const resume = () => {
    if (nativeRef.current) {
      if (wantRecordingRef.current && !stoppingRef.current) setNativePaused(false);
      return;
    }
    if (pausedAtRef.current === null) return;
    pausedMsRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    quietSinceRef.current = null;
    chunkerRef.current?.resume();
    patch({ isPaused: false, statusMsg: "Recording…" });
  };

  const stop = useCallback(async () => {
    if (nativeRef.current) {
      await stopNative();
      return;
    }
    wantRecordingRef.current = false;
    secondsRef.current = elapsedSeconds();
    chunkerRef.current?.flush(); // send the phrase that was mid-way when Stop was tapped
    if (socketRef.current) {
      // Deepgram: stop sending audio, then wait for the last words before closing.
      chunkerRef.current?.stop();
      chunkerRef.current = null;
      patch({ statusMsg: "Finishing transcription…" });
      await closeDeepgram();
    }
    cleanupMedia();
    if (pausedAtRef.current !== null) {
      pausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    patch({
      isRecording: false, isPaused: false, interimText: "", micLevel: 0, noSound: false,
      recordingSeconds: secondsRef.current, statusMsg: "Stopped. Saving…",
      // Not "saved" until the final save below: the meeting link only appears once everything is in.
      saveState: "saving",
    });
    // Wait for the device to finish transcribing the last phrases.
    if (pendingSegmentsRef.current.size) patch({ statusMsg: "Finishing transcription…" });
    await Promise.all([...pendingSegmentsRef.current]);
    // Device-first checkpoint of everything transcribed before the optional (slow) refinement.
    try { await save(); } catch { /* the final save below retries */ }
    await refineSpeakers(); // no-op unless on-device diarization ran; never throws
    // Autosave has stopped by now, so retry the final save a few times (phones drop requests).
    if (localModeRef.current) {
      // Device write first, then the engine uploads (flush retries for up to 15 s).
      flushResultRef.current = null;
      await save("DONE");
      const id = meetingIdRef.current;
      if (id) markRecording(id, false);
      const r = flushResultRef.current as FlushResult | null;
      if (r === "synced") {
        patch({ statusMsg: "Saved to your account.", saveState: "saved", syncNote: null });
      } else if (r === "needs-auth") {
        patch({ statusMsg: "Saved on this device. Sign in again to upload it.", saveState: "local", syncNote: "Sign in to sync" });
      } else {
        patch({ statusMsg: "Saved on this device. It will upload when you're online.", saveState: "local", syncNote: "Waiting for internet" });
      }
      patch({ interimText: "", liveStatus: null, backlog: 0 });
      return;
    }
    let saved = false;
    for (let attempt = 0; attempt < 4 && !saved; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
      saved = await save("DONE");
    }
    if (saved && relabelDoneRef.current) {
      // Server-direct recording: push the refined labels with retries (vectors never leave the device).
      const id = meetingIdRef.current;
      const names = relabelNamesRef.current;
      if (id) {
        const body = JSON.stringify({
          parts: partsRef.current.map((p, i) => ({ index: i, speaker: p.speaker })).slice(0, 60000),
          ...(names && Object.keys(names).length ? { speakerNames: names } : {}),
        });
        // Retry like the final save: a lost request would leave stale live labels on the server for good.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
          try {
            const res = await fetch(`/api/meetings/${id}/speakers`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body,
            });
            if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) break;
          } catch {
            /* retry */
          }
        }
      }
    }
    patch({
      statusMsg: saved
        ? "Saved to your account."
        : "Couldn't save the last part — check the connection. Your earlier autosaves are kept.",
      interimText: "", liveStatus: null, backlog: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);
  stopRef.current = stop;

  // ---- Native (locked-screen) session -----------------------------------------
  // The Android service records the microphone to files on the phone (works offline, with the screen
  // locked); this page reads them back, cuts phrases with the same voice detection, and transcribes them
  // with the same on-device model. Everything before the "committed cursor" is already in the transcript.

  /** Sample up to which the transcript holds everything (phrases being spoken or transcribed hold it back). */
  const computeCommitted = (): number =>
    committedCursor({
      readPos: readPosRef.current,
      openStart: chunkerRef.current ? chunkerRef.current.openStart() : null,
      inFlightStarts: inFlightRef.current.values(),
    });

  const nativeBehind = () => Math.max(0, headRef.current - readPosRef.current);
  const finishingText = () =>
    (finishNoteRef.current ? `${finishNoteRef.current} ` : "") + finishingLine(nativeBehind(), rateRef.current.rate());

  /** Stops the timers of a native session (never flushes the chunker: the open phrase is re-read from the cursor). */
  const cleanupNativeTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    timerRef.current = null;
    autosaveRef.current = null;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  /** Reads what the service recorded and feeds it to the chunker, until told to stop or the recording is over. */
  const runPump = async (id: string) => {
    let readFailures = 0;
    let lastStopNudge = 0;
    while (pumpAliveRef.current) {
      const chunker = chunkerRef.current;
      if (!chunker) break;
      const catching = isCatchingUp(headRef.current, readPosRef.current);
      catchingUpRef.current = catching;
      // Behind: hand the worker one batch at a time (finished phrases, then their speaker embeddings),
      // driven by promises rather than timers so a hidden page keeps going.
      if (catching && (pendingSegmentsRef.current.size > 0 || pendingEmbeds() > 0)) {
        await Promise.all([...pendingSegmentsRef.current]);
        await drainEmbeddings(EMBED_DRAIN_MS);
        continue;
      }
      let r: NativeReadAudioResult;
      try {
        r = await MeetingRecorder.readAudio({ meetingId: id, from: readPosRef.current, maxSamples: readSizeFor(catching) });
        readFailures = 0;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "GONE") {
          // Audio before `committed` was released: jump over the hole (a break, so nothing is stitched).
          const list = await MeetingRecorder.listCaptures().catch(() => null);
          const info = list?.captures.find((c) => c.meetingId === id);
          if (info && info.committed > readPosRef.current) {
            readPosRef.current = info.committed;
            chunker.breakAt(info.committed);
            continue;
          }
        }
        if (code === "NOT_FOUND" || ++readFailures >= 5) {
          nativeFailedRef.current = true;
          break;
        }
        await sleep(1000);
        continue;
      }
      headRef.current = Math.max(headRef.current, r.head);
      if (r.samples === 0) {
        if (r.ended) {
          nativeDrainedRef.current = true;
          break;
        }
        if (stoppingRef.current) {
          // Stop was asked for: wait for the service to close the files (re-ask now and then).
          const st = await MeetingRecorder.getState({ from: 1_000_000_000 }).catch(() => null);
          if (st && !(st.active && st.mode === "local" && st.meetingId === id)) {
            nativeDrainedRef.current = true;
            break;
          }
          if (performance.now() - lastStopNudge > 5000) {
            lastStopNudge = performance.now();
            MeetingRecorder.stop({ force: false }).catch(() => {});
          }
        }
        await sleep(400);
        continue;
      }
      for (const fr of frameBlock(pcm16Base64ToFloat32(r.data), r.from, r.breaks)) {
        if (fr.breakAt !== undefined) chunker.breakAt(fr.breakAt);
        chunker.feed(fr.samples);
      }
      readPosRef.current = r.from + r.samples;
      if (catching) rateRef.current.add(performance.now(), readPosRef.current);
      else rateRef.current = new RateMeter();
      if (r.ended && readPosRef.current >= r.head) {
        nativeDrainedRef.current = true;
        break;
      }
      if (!catching && r.samples < readSizeFor(false)) await sleep(400); // caught up with the microphone: wait for more
    }
    catchingUpRef.current = false;
  };

  /** Twice a second: the service's own clock, level, pause state, and whether it is still running. */
  const nativeTick = async () => {
    const id = meetingIdRef.current;
    if (!nativeRef.current || !id || nativeTickBusyRef.current) return;
    if (stoppingRef.current) {
      patch({ statusMsg: finishingText() });
      return;
    }
    nativeTickBusyRef.current = true;
    try {
      const st = await MeetingRecorder.getState({ from: 1_000_000_000 });
      if (!nativeRef.current || meetingIdRef.current !== id || stoppingRef.current) return;
      const ours = st.mode === "local" && st.meetingId === id;
      if (ours && st.active) sawActiveRef.current = true;
      if (ours) {
        if (typeof st.headSamples === "number") headRef.current = Math.max(headRef.current, st.headSamples);
        const tap = nativePauseTapRef.current;
        const paused = tap && performance.now() - tap.at < 1500 ? tap.value : !!st.paused;
        secondsRef.current = Math.floor(st.seconds ?? secondsRef.current);
        const running = st.active && !paused;
        const notice = storageNotice({ freeBytes: st.freeBytes, stoppedReason: st.stoppedReason });
        setState((s) => ({
          ...s,
          notice: s.notice?.text === notice?.text ? s.notice : notice,
          recordingSeconds: secondsRef.current,
          isPaused: paused,
          micLevel: running ? st.level : 0,
          noSound: running && !!st.noSound,
          statusMsg:
            failedPhrasesRef.current >= MAX_FAILED_PHRASES
              ? s.statusMsg
              : nativeStatusLine({ paused, behindSamples: nativeBehind(), rate: rateRef.current.rate() }),
        }));
      }
      if (ours && st.active) return;
      // The service is not running (yet, or any more).
      const waited = performance.now() - nativeStartedAtRef.current;
      if (!sawActiveRef.current && waited < NATIVE_START_GRACE_MS) return;
      if (headRef.current <= 0 && !(ours && (st.headSamples ?? 0) > 0)) {
        // It never recorded anything: say why, and leave nothing behind.
        failNativeStart(id, ours && st.status ? st.status : "The phone didn't start recording. Try again.");
        return;
      }
      // Stopped from the notification, out of storage, or ended by Android: finish the transcript here too.
      if (wantRecordingRef.current) void stopRef.current();
    } catch {
      /* bridge busy: try again next tick */
    } finally {
      nativeTickBusyRef.current = false;
    }
  };

  /** A native start that produced no audio: clean up, tell the user. */
  const failNativeStart = (id: string, message: string) => {
    wantRecordingRef.current = false;
    pumpAliveRef.current = false;
    cleanupNativeTimers();
    chunkerRef.current = null;
    MeetingRecorder.stop({ force: true }).catch(() => {});
    setTimeout(() => MeetingRecorder.discardCapture({ meetingId: id }).catch(() => {}), 2000);
    nativeRef.current = false;
    discardEmptyLocal();
    resetDiarization();
    patch({ isStarting: false, isRecording: false, isPaused: false, micLevel: 0, noSound: false, statusMsg: message });
  };

  /** Autosave for a native session: the transcript, plus the cursor even when nothing new was said. */
  const autosaveNative = () => {
    if (computeCommitted() - persistedCursorRef.current >= CURSOR_PERSIST_SAMPLES) dirtyRef.current = true;
    void save();
    flushEmbedBuffer();
    const uid = localUserRef.current.userId;
    const rid = meetingIdRef.current;
    if (uid && rid) void touchRecording(uid, rid);
  };

  /** Starts reading the service's audio from `startAt` and transcribing it (fresh start, or a re-attach). */
  const attachNative = (startAt: number, id: string) => {
    pumpAliveRef.current = true;
    stoppingRef.current = false;
    nativeDrainedRef.current = false;
    nativeFailedRef.current = false;
    catchingUpRef.current = false;
    rateRef.current = new RateMeter();
    inFlightRef.current.clear();
    readPosRef.current = startAt;
    headRef.current = Math.max(headRef.current, startAt);
    persistedCursorRef.current = startAt;
    releasedRef.current = startAt;
    previewsRef.current.clear();
    lastEmittedPhraseRef.current = 0;
    speakingRef.current = false;
    nativeStartedAtRef.current = performance.now();
    const chunker = VoiceChunker.forFeed(
      {
        onSpeechChange: (speaking) => {
          speakingRef.current = speaking;
          showMoonshineActivity();
        },
        onSegment: (audio, phraseId, startSec, firstSample) => onPhrase(audio, phraseId, startSec, firstSample),
      },
      startAt,
    );
    chunkerRef.current = chunker;
    timerRef.current = setInterval(() => void nativeTick(), 500);
    autosaveRef.current = setInterval(autosaveNative, AUTOSAVE_MS);
    if (previewIntervalRef.current !== null) previewTimerRef.current = setTimeout(previewTick, previewIntervalRef.current);
    pumpRef.current = runPump(id);
  };

  /** Fresh native session: new meeting on the device, the service records, the page transcribes. */
  const startNative = async () => {
    const engine = opts.engine as "moonshine" | "whisper"; // the caller only comes here for on-device engines
    const language = engine === "moonshine" ? "en" : opts.language;
    const token = ++startTokenRef.current;
    startingRef.current = true;
    nativeRef.current = true;
    sessionEngineRef.current = engine;
    partsRef.current = [];
    savedPartsRef.current = 0;
    secondsRef.current = 0;
    startedAtRef.current = 0;
    pausedMsRef.current = 0;
    pausedAtRef.current = null;
    dirtyRef.current = false;
    localModeRef.current = false;
    serverRowRef.current = false;
    flushResultRef.current = null;
    startIdRef.current = null;
    setLocalMode(false);
    speakingRef.current = false;
    pendingSegmentsRef.current.clear();
    failedPhrasesRef.current = 0;
    nativePauseTapRef.current = null;
    sawActiveRef.current = false;
    readPosRef.current = 0;
    headRef.current = 0;
    resetDiarization();
    patch({
      speakerNames: null, speakerStatus: null,
      transcriptParts: [], interimText: "", liveStatus: null, backlog: 0, micLevel: 0, noSound: false,
      recordingSeconds: 0, isPaused: false, isStarting: true, isRecording: false,
      statusMsg: "Loading speech model…", saveState: "idle", meetingId: null, syncNote: null, stoppedRemotely: false,
      finishing: false, notice: null,
    });
    finishNoteRef.current = null;

    const newId = newMeetingId();
    startIdRef.current = newId;
    const uid = localUserRef.current.userId as string;
    const meetingTitle = `Meeting – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
    const localCreated = createLocal(uid, {
      id: newId, title: meetingTitle, language, engine, deviceName: detectDeviceName(), origin: "local", nativeCapture: true,
    });
    markRecording(newId, true);
    try {
      await prepareOnDevice(engine, language, token);
      patch({ statusMsg: "Creating meeting…" });
      if (!(await localCreated)) throw new Error("Couldn't create the meeting on this phone.");
      if (startTokenRef.current !== token) throw new StartCancelled();
      localModeRef.current = true;
      meetingIdRef.current = newId;
      setLocalMode(true);
      patch({ meetingId: newId, saveState: "local", syncNote: null, statusMsg: "Starting the recorder…" });
      poke(newId); // the engine does the idempotent server POST whenever it can
      wantRecordingRef.current = true;
      await MeetingRecorder.start({ meetingId: newId, language, mode: "local", engine });
      if (startTokenRef.current !== token) throw new StartCancelled();
      await acquireWakeLock();
      attachNative(0, newId);
      patch({ isStarting: false, isRecording: true, statusMsg: nativeStatusLine({ paused: false, behindSamples: 0 }) });
    } catch (e) {
      if (e instanceof StartCancelled || startTokenRef.current !== token) return;
      wantRecordingRef.current = false;
      pumpAliveRef.current = false;
      cleanupNativeTimers();
      chunkerRef.current = null;
      MeetingRecorder.stop({ force: true }).catch(() => {});
      setTimeout(() => MeetingRecorder.discardCapture({ meetingId: newId }).catch(() => {}), 2000);
      nativeRef.current = false;
      discardEmptyLocal();
      resetDiarization();
      const err = e as { code?: string; message?: string };
      patch({
        isRecording: false, isStarting: false,
        statusMsg:
          err?.code === "DENIED"
            ? "Microphone access was denied. Allow it in Settings › Apps › Transcriber › Permissions."
            : err?.message?.startsWith("Failed to fetch") || err?.message === "Load failed"
              ? "Network problem. Check the connection and try again."
              : `Recording error: ${err?.message || "Unknown error"}`,
      });
    } finally {
      if (startTokenRef.current === token) startingRef.current = false;
    }
  };

  /**
   * The Record screen came back while the service holds a capture (renderer reload, app reopened, or the
   * screen was left and re-entered): re-attach. Never calls start(): that would continue the folder and add a break.
   */
  const attachExisting = async (info: CaptureInfoLite, uid: string): Promise<boolean> => {
    const id = info.meetingId;
    /** The service is not capturing any more (stopped, or killed by Android): only the transcript is left to finish. */
    const finalize = !info.active;
    const token = ++startTokenRef.current;
    startingRef.current = true;
    nativeRef.current = true;
    const engine: RecordEngine = info.engine === "whisper" ? "whisper" : "moonshine";
    sessionEngineRef.current = engine;
    try {
      const meta = await getMeta(uid, id);
      const got = await getParts(uid, id);
      if (!meta || !got) throw new Error("This recording isn't on this phone any more.");
      if (startTokenRef.current !== token) throw new StartCancelled();
      resetDiarization();
      partsRef.current = got.parts;
      savedPartsRef.current = meta.savedParts;
      secondsRef.current = meta.durationSec;
      dirtyRef.current = false;
      pendingSegmentsRef.current.clear();
      failedPhrasesRef.current = 0;
      nativePauseTapRef.current = null;
      sawActiveRef.current = info.active;
      meetingIdRef.current = id;
      localModeRef.current = true;
      setLocalMode(true);
      markRecording(id, true);
      patch({
        meetingId: id, transcriptParts: got.parts, recordingSeconds: meta.durationSec, isStarting: true, isRecording: false,
        isPaused: false, saveState: "local", syncNote: null, stoppedRemotely: false, speakerNames: meta.speakerNames,
        statusMsg: finalize ? recoveryNote(info) : "Reconnecting to the recording…",
        finishing: false, notice: storageNotice({ stoppedReason: info.stoppedReason }),
      });
      finishNoteRef.current = finalize ? recoveryNote(info) : null;
      speakerNamesRef.current = meta.speakerNames;
      await prepareOnDevice(engine, info.language || "en", token);
      // Speaker identification: replay the saved voices in order, so new phrases join the same speakers.
      const online = onlineRef.current;
      if (online) {
        for (const e of await getEmbeddings(uid, id)) {
          if (!got.parts[e.part]) continue;
          try {
            assignOnline(online, e.vec);
            vectorsRef.current.set(e.part, e.vec);
          } catch {
            /* a bad vector only costs a label */
          }
        }
      }
      if (startTokenRef.current !== token) throw new StartCancelled();
      headRef.current = info.head;
      wantRecordingRef.current = !finalize;
      if (!finalize) await acquireWakeLock();
      attachNative(resumeFrom({ nativeCapture: meta.nativeCapture, nativeCursor: meta.nativeCursor, status: meta.status }, info), id);
      if (finalize) patch({ isStarting: false, isRecording: false });
      else patch({ isStarting: false, isRecording: true, statusMsg: nativeStatusLine({ paused: false, behindSamples: nativeBehind() }) });
      return true;
    } catch (e) {
      if (e instanceof StartCancelled || startTokenRef.current !== token) return false;
      wantRecordingRef.current = false;
      pumpAliveRef.current = false;
      cleanupNativeTimers();
      chunkerRef.current = null;
      nativeRef.current = false;
      patch({
        isStarting: false, isRecording: false,
        statusMsg: `Couldn't reconnect to the recording: ${(e as Error)?.message || "unknown error"}. The audio is kept on the phone.`,
      });
      return false;
    } finally {
      if (startTokenRef.current === token) startingRef.current = false;
    }
  };

  /** On mount: find a capture the service is still running (or left behind) and pick it up. */
  const resumeNative = async () => {
    const uid = localUserRef.current.userId;
    if (!uid) return;
    try {
      await detachBarrier;
    } catch {
      /* the previous screen's cleanup failing must not block this one */
    }
    if (startingRef.current || wantRecordingRef.current || finalizingRef.current) return;
    if (!(await nativeCapabilities()).localCapture) return;
    const list = await MeetingRecorder.listCaptures().catch(() => null);
    if (!list) return;
    // Rows that claim audio the phone no longer has would show "Needs finishing" forever.
    await releaseStaleNativeClaims(uid, new Set(list.captures.map((c) => c.meetingId)), 10 * 60_000).catch(() => 0);
    if (list.captures.length === 0) return;
    const rows = new Map<string, NativeRowInfo>();
    for (const c of list.captures) {
      const m = await getMeta(uid, c.meetingId);
      if (m) rows.set(c.meetingId, { nativeCapture: m.nativeCapture, nativeCursor: m.nativeCursor, status: m.status });
    }
    if (startingRef.current || wantRecordingRef.current || finalizingRef.current) return;
    const { live, unfinished, orphans } = pickCapture(list.captures, rows);
    // Left over from a crash between "meeting finished" and "audio deleted": the text is safe, delete the audio.
    for (const o of orphans) MeetingRecorder.discardCapture({ meetingId: o.meetingId }).catch(() => {});
    if (live) {
      await attachExisting(live, uid);
      return;
    }
    // Stopped from the notification, by Android, or out of storage while the page was not there:
    // transcribe what is on disk and finish the meeting, one capture after another.
    for (const c of unfinished) {
      if (!(await attachExisting(c, uid))) break;
      await stopNative();
      if (!nativeDrainedRef.current) break; // could not read it all: it stays on the phone for next time
    }
  };

  /** Pause/resume tap on a native session: shown at once, the service confirms through nativeTick. */
  const setNativePaused = (value: boolean) => {
    nativePauseTapRef.current = { at: performance.now(), value };
    (value ? MeetingRecorder.pause() : MeetingRecorder.resume()).catch(() => {});
    patch(
      value
        ? { isPaused: true, micLevel: 0, noSound: false, statusMsg: nativeStatusLine({ paused: true, behindSamples: 0 }) }
        : { isPaused: false, statusMsg: nativeStatusLine({ paused: false, behindSamples: nativeBehind(), rate: rateRef.current.rate() }) },
    );
  };

  /**
   * Stop for a native session: the service closes its files, the page reads whatever is left, finishes the
   * phrases, refines the speakers, then writes DONE together with clearing `nativeCapture`; only then is
   * the audio deleted from the phone.
   */
  const stopNative = async () => {
    const id = meetingIdRef.current;
    if (!id || stoppingRef.current) return;
    const run = (async () => {
      stoppingRef.current = true;
      finalizingRef.current = true;
      wantRecordingRef.current = false;
      patch({
        isRecording: false, isPaused: false, interimText: "", micLevel: 0, noSound: false,
        statusMsg: finishingText(), saveState: "saving", finishing: true,
      });
      try {
        // Only tell the service to stop when it is recording THIS meeting (a finished capture being
        // completed here must not stop some other recording).
        void MeetingRecorder.getState({ from: 1_000_000_000 })
          .then((st) => {
            if (st.active && st.mode === "local" && st.meetingId === id) return MeetingRecorder.stop({ force: false });
          })
          .catch(() => {});
        await pumpRef.current; // ends at the last sample the service wrote (or when reading keeps failing)
        if (nativeDrainedRef.current) {
          chunkerRef.current?.flush(); // the phrase that was mid-way when the recording ended
          secondsRef.current = Math.max(secondsRef.current, Math.floor(headRef.current / NATIVE_SAMPLE_RATE));
        }
        while (pendingSegmentsRef.current.size) await Promise.all([...pendingSegmentsRef.current]);
        dirtyRef.current = true;
        try { await save(undefined, true); } catch { /* the final save below retries */ }
        if (!nativeDrainedRef.current) {
          // Not everything could be read: keep the audio, finish next time.
          patch({
            statusMsg: "Couldn't read all of the recording. It is kept on this phone. Open Record again to finish it.",
            saveState: "local", liveStatus: null, backlog: 0,
          });
          return;
        }
        await refineSpeakers(); // no-op unless on-device diarization ran; never throws
        flushResultRef.current = null;
        nativeFinishedRef.current = false;
        await save("DONE");
        markRecording(id, false);
        if (nativeFinishedRef.current) {
          // The write that clears nativeCapture succeeded: the audio is no longer needed.
          MeetingRecorder.discardCapture({ meetingId: id }).catch(() => {});
        }
        const r = flushResultRef.current as FlushResult | null;
        if (r === "synced") {
          patch({ statusMsg: "Saved to your account.", saveState: "saved", syncNote: null });
        } else if (r === "needs-auth") {
          patch({ statusMsg: "Saved on this device. Sign in again to upload it.", saveState: "local", syncNote: "Sign in to sync" });
        } else {
          patch({ statusMsg: "Saved on this device. It will upload when you're online.", saveState: "local", syncNote: "Waiting for internet" });
        }
        patch({ interimText: "", liveStatus: null, backlog: 0 });
      } finally {
        cleanupNativeTimers();
        pumpAliveRef.current = false;
        patch({ finishing: false });
        if (nativeDrainedRef.current) {
          chunkerRef.current = null;
          nativeRef.current = false;
        }
        finalizingRef.current = false;
        stoppingRef.current = false;
      }
    })();
    // A screen that opens meanwhile waits for this to end before it reads the device store.
    const barrier = run.catch(() => {}).finally(() => {
      if (detachBarrier === barrier) detachBarrier = null;
    });
    detachBarrier = barrier;
    await run;
  };

  /**
   * The Record screen is being left while a native session runs: capture carries on in the service; this
   * screen finishes the phrases it already cut, writes a last cursor, and lets go. The phrase in progress
   * is not cut: the cursor stays at its start and the next screen re-reads it.
   */
  const detachNative = () => {
    pumpAliveRef.current = false;
    cleanupNativeTimers();
    wantRecordingRef.current = false;
    const run = (async () => {
      try {
        await pumpRef.current;
        while (pendingSegmentsRef.current.size) await Promise.all([...pendingSegmentsRef.current]);
        dirtyRef.current = true;
        await save(undefined, true);
        flushEmbedBuffer();
      } catch {
        /* the next screen re-reads from the stored cursor */
      } finally {
        chunkerRef.current = null;
        try { unsubEmbedRef.current?.(); } catch { /* silent */ }
        unsubEmbedRef.current = null;
        nativeRef.current = false;
      }
    })();
    const barrier = run.finally(() => {
      if (detachBarrier === barrier) detachBarrier = null;
    });
    detachBarrier = barrier;
  };

  /** Builds a MediaStream from the sample clip; it's also played out loud so you can follow along. */
  const createSampleStream = async (ctx: AudioContext): Promise<MediaStream> => {
    const res = await fetch(SAMPLE_AUDIO_URL);
    if (!res.ok) throw new Error("Could not download the sample audio.");
    const audio = new Audio(URL.createObjectURL(await res.blob())); // blob URL: same-origin, OK under COEP
    const source = ctx.createMediaElementSource(audio);
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest);
    source.connect(ctx.destination);
    sampleAudioRef.current = audio;
    return dest.stream;
  };

  /** Starts the sample clip once recording is live, and stops recording shortly after it ends. */
  const playSampleIfAny = () => {
    const audio = sampleAudioRef.current;
    if (!audio || !audio.paused) return;
    audio.onended = () => setTimeout(() => { if (wantRecordingRef.current) stop(); }, 1200);
    audio.play().catch((err) => console.error("Sample playback failed:", err));
  };

  /** A start that fails or is cancelled leaves no empty meeting on the device. */
  const discardEmptyLocal = () => {
    const id = startIdRef.current;
    if (!id) return;
    markRecording(id, false);
    const uid = localUserRef.current.userId;
    if (uid && partsRef.current.length === 0) {
      purge(uid, id).catch(() => {});
      if (meetingIdRef.current === id) meetingIdRef.current = null;
    }
    startIdRef.current = null;
  };

  /** Cancels a start that's still in progress (mic prompt, model download, connecting). */
  const cancelStart = useCallback(() => {
    startTokenRef.current += 1;
    startingRef.current = false;
    wantRecordingRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    if (nativeRef.current) {
      // A native start in progress: if the service already began, stop it and delete what it wrote.
      const nid = startIdRef.current;
      pumpAliveRef.current = false;
      cleanupNativeTimers();
      chunkerRef.current = null;
      nativeRef.current = false;
      if (nid) {
        MeetingRecorder.stop({ force: true }).catch(() => {});
        setTimeout(() => MeetingRecorder.discardCapture({ meetingId: nid }).catch(() => {}), 2000);
      }
    }
    cleanupMedia();
    discardEmptyLocal();
    resetDiarization();
    patch({ isStarting: false, isRecording: false, statusMsg: "Cancelled.", speakerStatus: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Loads the speech model (the first use downloads it) and starts the optional speaker identification.
   * Throws StartCancelled if the start was cancelled or superseded meanwhile (`token` no longer current).
   */
  const prepareOnDevice = async (engine: "moonshine" | "whisper", language: string, token: number) => {
    // First use downloads the model (tens of MB); after that it loads from the browser cache.
    patch({ statusMsg: "Loading speech model…" });
    const { model } = await loadSpeechModel(engine, language, (pct) => patch({ statusMsg: `Downloading speech model… ${pct}%` }), {
      onModelChange: (m) => {
        const hadPreviews = previewIntervalRef.current !== null;
        previewIntervalRef.current = previewIntervalFor(m);
        // Lighter model allows live previews again: restart them.
        if (!hadPreviews && previewIntervalRef.current !== null && chunkerRef.current) {
          previewTimerRef.current = setTimeout(previewTick, previewIntervalRef.current);
        }
        if (wantRecordingRef.current) {
          patch({ statusMsg: "Recording — switched to the faster model for this phone…" });
        }
      },
    });
    previewIntervalRef.current = previewIntervalFor(model);
    if (startTokenRef.current !== token) throw new StartCancelled();
    // Speaker identification is optional and never awaited: a missing model must not delay start.
    try {
      onlineRef.current = createOnline();
      unsubEmbedRef.current = onEmbedding(handleEmbedding);
      void loadSpeakerModel()
        .then((ok) => { if (startTokenRef.current === token) diarizeOnRef.current = ok; })
        .catch(() => {});
    } catch {
      /* silent */
    }
  };

  const start = useCallback(async (source: AudioSource = "mic") => {
    // Ignore taps while already starting or recording (a second tap used to start a second recording).
    if (startingRef.current || wantRecordingRef.current || finalizingRef.current) return;
    const useSample = source === "sample";

    // Android app with the offline-capture service: record on-device through it, so capture carries on
    // with the screen locked. The website and older installed APKs fall through to the microphone path below.
    if (!useSample && opts.engine !== "deepgram" && isNativeApp()) {
      startingRef.current = true;
      let capable = false;
      try {
        capable = (await nativeCapabilities()).localCapture;
      } finally {
        startingRef.current = false;
      }
      const lu = localUserRef.current;
      if (capable && lu.userId && lu.available) {
        await startNative();
        return;
      }
    }
    nativeRef.current = false;
    sessionEngineRef.current = opts.engine;

    // Microphone, audio processing and fast on-device models all need a secure page: https://, or
    // localhost. Phones opening the laptop's http://192.168.x.x address get none of them.
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!window.isSecureContext || !Ctx || (!useSample && !navigator.mediaDevices?.getUserMedia)) {
      patch({
        statusMsg: !window.isSecureContext
          ? "Recording needs a secure (https://) address. On a phone, open the app's https link instead of http://."
          : "This browser can't record audio. Try the latest Chrome or Safari.",
      });
      return;
    }

    const token = ++startTokenRef.current;
    /** Bails out if the user cancelled (or a newer start began) while we were waiting. */
    const check = () => {
      if (startTokenRef.current !== token) throw new StartCancelled();
    };
    startingRef.current = true;
    partsRef.current = [];
    savedPartsRef.current = 0;
    secondsRef.current = 0;
    startedAtRef.current = 0;
    pausedMsRef.current = 0;
    pausedAtRef.current = null;
    dirtyRef.current = false;
    localModeRef.current = false;
    serverRowRef.current = false;
    flushResultRef.current = null;
    startIdRef.current = null;
    setLocalMode(false);
    speakingRef.current = false;
    pendingSegmentsRef.current.clear();
    failedPhrasesRef.current = 0;
    resetDiarization();
    lastFrameAtRef.current = performance.now();
    patch({
      speakerNames: null, speakerStatus: null,
      transcriptParts: [], interimText: "", liveStatus: null, backlog: 0, micLevel: 0, noSound: false,
      recordingSeconds: 0, isPaused: false, isStarting: true, isRecording: false,
      statusMsg: useSample ? "Loading sample audio…" : "Requesting microphone…", saveState: "idle", meetingId: null,
      syncNote: null, stoppedRemotely: false, finishing: false, notice: null,
    });

    // The audio context is created before any await so it counts as part of the tap
    // (iOS only allows audio to start then).
    const ctx = new Ctx();
    moonCtxRef.current = ctx;
    ctx.resume().catch(() => {});
    // iOS can suspend/interrupt the context when the mic switches the audio session, or later
    // (calls, Siri). Try to bring it back whenever that happens.
    ctx.onstatechange = () => {
      if (ctx.state !== "running" && ctx.state !== "closed" && wantRecordingRef.current) ctx.resume().catch(() => {});
    };

    // Device-first: the meeting id and the local row are made now (before the first await, so the
    // iOS tap ordering is kept); the server row is created later by the sync engine.
    const newId = newMeetingId();
    startIdRef.current = newId;
    const meetingLanguage = opts.engine === "moonshine" ? "en" : opts.language;
    // Titled with the device's local time (the server may run in UTC, which gave 6:58 am for 12:28 pm).
    const meetingTitle = `${useSample ? "Sample recording" : "Meeting"} – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
    const lu = localUserRef.current;
    let localCreated: Promise<boolean> | null = null;
    if (lu.userId && lu.available) {
      localCreated = createLocal(lu.userId, {
        id: newId, title: meetingTitle, language: meetingLanguage, engine: opts.engine,
        deviceName: detectDeviceName(), origin: "local",
      });
      markRecording(newId, true);
    }

    try {
      let mic: MediaStream;
      if (useSample) {
        mic = await createSampleStream(ctx);
      } else {
        const constraints = micConstraints(opts.engine, opts.deviceId);
        mic = await navigator.mediaDevices.getUserMedia({ audio: constraints }).catch((err: DOMException) => {
          // Chosen mic unplugged, or a setting this device can't do: retry with the default mic.
          // (Never retry after the user said no — that's a real answer.)
          if (err?.name !== "OverconstrainedError" && err?.name !== "NotFoundError" && err?.name !== "NotReadableError") throw err;
          const { deviceId: _unused, ...rest } = constraints;
          return navigator.mediaDevices.getUserMedia({ audio: rest });
        });
        // Getting the mic changes the phone's audio session; resume again so iOS doesn't leave it suspended.
        ctx.resume().catch(() => {});
      }
      streamsRef.current.push(mic);
      check();

      let recordStream: MediaStream = mic;
      // System audio (Zoom/Teams tab) only exists on desktop browsers.
      if (!useSample && opts.captureSystemAudio && navigator.mediaDevices.getDisplayMedia) {
        const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => null);
        if (sys && sys.getAudioTracks().length > 0) {
          streamsRef.current.push(sys);
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ac = new Ctx();
          audioCtxRef.current = ac;
          const dest = ac.createMediaStreamDestination();
          ac.createMediaStreamSource(mic).connect(dest);
          ac.createMediaStreamSource(new MediaStream(sys.getAudioTracks())).connect(dest);
          recordStream = dest.stream;
        }
      }
      recordStreamRef.current = recordStream;

      const engine = opts.engine;
      const language = engine === "moonshine" ? "en" : opts.language;
      if (engine !== "deepgram") await prepareOnDevice(engine, language, token);

      patch({ statusMsg: "Creating meeting…" });
      const useLocal = localCreated ? await localCreated : false;
      check();
      localModeRef.current = useLocal;
      if (useLocal) {
        meetingIdRef.current = newId;
        setLocalMode(true);
        patch({ meetingId: newId, saveState: "local", syncNote: null, statusMsg: "Starting…" });
        poke(newId); // the engine does the idempotent server POST whenever it can
      } else {
        const res = await fetch("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newId,
            language,
            engine: opts.engine,
            deviceName: detectDeviceName(),
            title: meetingTitle,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.meeting) {
          throw new Error(
            res.status === 401
              ? "You've been signed out. Sign in again."
              : data.error || `Could not create the meeting (error ${res.status}).`
          );
        }
        check();
        meetingIdRef.current = data.meeting.id;
        patch({ meetingId: data.meeting.id, statusMsg: "Starting…" });
      }

      wantRecordingRef.current = true;
      await acquireWakeLock();
      if (engine === "deepgram") await startDeepgram();
      else await startMoonshine();
      check();
      playSampleIfAny();

      startedAtRef.current = Date.now();
      lastFrameAtRef.current = performance.now();
      timerRef.current = setInterval(tick, 500);
      autosaveRef.current = setInterval(() => {
        void save();
        flushEmbedBuffer();
        // Heartbeat so another tab's orphan recovery can tell a quiet meeting from an abandoned one.
        const uid = localUserRef.current.userId;
        const rid = meetingIdRef.current;
        if (localModeRef.current && uid && rid) void touchRecording(uid, rid);
      }, AUTOSAVE_MS);
      patch({ isStarting: false });
    } catch (e) {
      // Cancelled (or superseded) while starting: cancelStart already cleaned up and set the message.
      if (e instanceof StartCancelled || startTokenRef.current !== token) return;
      wantRecordingRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      cleanupMedia();
      discardEmptyLocal();
      const err = e as { name?: string; message?: string };
      const msg =
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "Microphone access was denied. Allow microphone permission for this site in the browser settings, or tap “Try with sample audio”."
          : err?.name === "NotReadableError"
            ? "Another app is using the microphone (a call or voice recorder?). Close it and try again."
            : err?.message?.startsWith("Failed to fetch") || err?.message === "Load failed"
              ? "Network problem — check the connection and try again."
              : `Recording error: ${err?.message || "Unknown error"}`;
      patch({ statusMsg: msg, isRecording: false, isStarting: false });
    } finally {
      if (startTokenRef.current === token) startingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.captureSystemAudio, opts.deviceId, opts.engine, opts.language, save]);

  // Save whatever we have if the page is closed mid-recording.
  useEffect(() => {
    const onUnload = () => { if (wantRecordingRef.current) save(undefined, true); };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [save]);

  // Leaving the Record screen (e.g. tapping "Meetings" in the tab bar) used to leave the mic and
  // timers running with no Stop button. Stop and save instead; cancel a start in progress.
  useEffect(() => {
    return () => {
      if (nativeRef.current && wantRecordingRef.current) detachNative(); // capture carries on in the service
      else if (nativeRef.current && finalizingRef.current) return; // finishing: let it end (the next screen waits for it)
      else if (wantRecordingRef.current) stopRef.current();
      else if (startingRef.current) cancelStart();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelStart]);

  // Picks up a capture the Android service still holds (screen re-entered, app reopened, page reloaded).
  useEffect(() => {
    if (!userId || !available || resumeTriedRef.current || !isNativeApp()) return;
    resumeTriedRef.current = true;
    void resumeNative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, available]);

  return { ...state, start, stop, pause, resume, cancelStart, renameSpeaker };
}
