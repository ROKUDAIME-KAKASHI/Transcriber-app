"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";
import { loadSpeechModel, transcribePartial, transcribeSegment } from "@/lib/speech/client";
import type { ModelName } from "@/lib/speech/models";
import { VoiceChunker } from "@/lib/speech/voiceChunker";
import { cleanPhrase } from "@/lib/speech/cleanText";
import { createLocal, getMeta, purge, putParts } from "@/lib/local/repo";
import { newMeetingId } from "@/lib/local/ids";
import { flush, markRecording, poke, type FlushResult } from "@/lib/local/sync";
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

  /** Page is closing: one last best-effort tail PATCH that outlives the page (only if the server row exists). */
  const sendKeepaliveTail = (id: string) => {
    if (!serverRowRef.current) return;
    const parts = partsRef.current;
    const from = Math.max(0, Math.min(savedPartsRef.current - 1, parts.length));
    const body = JSON.stringify({ transcriptTail: { from, parts: parts.slice(from) }, durationSec: secondsRef.current });
    if (body.length >= 60_000) return;
    fetch(`/api/meetings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  /** Device-first save: write to IndexedDB, then let the sync engine upload. Falls back to the server path if the write fails. */
  const saveLocal = async (id: string, status?: "DONE", closing = false): Promise<boolean> => {
    const uid = localUserRef.current.userId;
    dirtyRef.current = false;
    const ok = uid ? await putParts(uid, id, partsRef.current, secondsRef.current, status) : false;
    if (!uid || !ok) return saveToServer(id, status, closing);
    if (closing) sendKeepaliveTail(id);
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
    if (!clean) return;
    partsRef.current = [...partsRef.current, { speaker: 0, text: clean, t: Math.round(startSec * 10) / 10 }];
    dirtyRef.current = true;
    patch({ transcriptParts: partsRef.current, interimText: "" });
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
      onSegment: (audio, phraseId, startSec) => {
        lastEmittedPhraseRef.current = phraseId;
        const job = transcribeSegment(audio)
          .then((text) => {
            failedPhrasesRef.current = 0;
            appendFinal(text, opts.engine === "whisper", startSec); // one chat bubble per phrase
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
            // The live preview for this phrase stays visible until its final text replaces it.
            previewsRef.current.delete(phraseId);
            pendingSegmentsRef.current.delete(job);
            showMoonshineActivity();
          });
        pendingSegmentsRef.current.add(job);
        showMoonshineActivity();
      },
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
    if (pausedAtRef.current === null) return;
    pausedMsRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    quietSinceRef.current = null;
    chunkerRef.current?.resume();
    patch({ isPaused: false, statusMsg: "Recording…" });
  };

  const stop = useCallback(async () => {
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
    patch({
      statusMsg: saved
        ? "Saved to your account."
        : "Couldn't save the last part — check the connection. Your earlier autosaves are kept.",
      interimText: "", liveStatus: null, backlog: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);
  stopRef.current = stop;

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
    cleanupMedia();
    discardEmptyLocal();
    patch({ isStarting: false, isRecording: false, statusMsg: "Cancelled." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async (source: AudioSource = "mic") => {
    // Ignore taps while already starting or recording (a second tap used to start a second recording).
    if (startingRef.current || wantRecordingRef.current) return;
    const useSample = source === "sample";

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
    lastFrameAtRef.current = performance.now();
    patch({
      transcriptParts: [], interimText: "", liveStatus: null, backlog: 0, micLevel: 0, noSound: false,
      recordingSeconds: 0, isPaused: false, isStarting: true, isRecording: false,
      statusMsg: useSample ? "Loading sample audio…" : "Requesting microphone…", saveState: "idle", meetingId: null,
      syncNote: null,
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
      if (engine !== "deepgram") {
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
        check();
      }

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
      autosaveRef.current = setInterval(() => save(), AUTOSAVE_MS);
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
      if (wantRecordingRef.current) stopRef.current();
      else if (startingRef.current) cancelStart();
    };
  }, [cancelStart]);

  return { ...state, start, stop, pause, resume, cancelStart };
}
