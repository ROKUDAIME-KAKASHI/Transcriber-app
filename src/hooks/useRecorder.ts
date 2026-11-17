"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";
import { loadMoonshine, transcribePartial, transcribeSegment } from "@/lib/moonshine/client";
import { VoiceChunker } from "@/lib/moonshine/voiceChunker";
import { cleanPhrase } from "@/lib/moonshine/cleanText";

const AUTOSAVE_MS = 5000;

/**
 * "Try with sample audio": a short public-domain speech clip (JFK, 1961) fed into the
 * recorder instead of the microphone, so transcription can be seen working without a mic
 * (e.g. in browsers or embedded views that block microphone access).
 */
const SAMPLE_AUDIO_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

export type AudioSource = "mic" | "sample";
export interface RecorderState {
  isRecording: boolean;
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
  statusMsg: string;
  saveState: "idle" | "saving" | "saved" | "error";
}

/** Below this RMS for NO_SOUND_MS the mic is treated as silent/wrong device. */
const NO_SOUND_RMS = 0.0004;
const NO_SOUND_MS = 5000;

/** rms → 0–1 on a −60 dB…0 dB scale, so quiet mics still move the meter. */
function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

export function useRecorder(opts: {
  captureSystemAudio: boolean;
  /** Microphone to use (from enumerateDevices); empty = browser default. */
  deviceId?: string;
}) {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    meetingId: null,
    transcriptParts: [],
    interimText: "",
    liveStatus: null,
    backlog: 0,
    micLevel: 0,
    noSound: false,
    recordingSeconds: 0,
    statusMsg: "Ready",
    saveState: "idle",
  });

  // Mutable refs for things callbacks need without re-rendering.
  const partsRef = useRef<TranscriptPart[]>([]);
  const secondsRef = useRef(0);
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
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  // Level meter / no-sound detection
  const lastLevelPaintRef = useRef(0);
  const quietSinceRef = useRef<number | null>(null);
  const noSoundRef = useRef(false);

  const patch = (p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p }));

  // ---- Persistence -------------------------------------------------------
  const save = useCallback(async (status?: "DONE") => {
    const id = meetingIdRef.current;
    if (!id || (!dirtyRef.current && !status)) return;
    dirtyRef.current = false;
    patch({ saveState: "saving" });
    try {
      const res = await fetch(`/api/meetings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: partsRef.current,
          durationSec: secondsRef.current,
          ...(status ? { status } : {}),
        }),
        keepalive: true, // lets the final save finish even if the tab is closing
      });
      if (!res.ok) throw new Error();
      patch({ saveState: "saved" });
    } catch {
      dirtyRef.current = true; // retry on next tick
      patch({ saveState: "error" });
    }
  }, []);

  /** Adds a finished phrase to the transcript, as its own chat bubble. */
  const appendFinal = (text: string) => {
    const clean = cleanPhrase(text);
    if (!clean) return;
    partsRef.current = [...partsRef.current, { speaker: 0, text: clean }];
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
  const PREVIEW_MIN_INTERVAL_MS = 350;
  const previewTick = async () => {
    const chunker = chunkerRef.current;
    if (!chunker || !wantRecordingRef.current) return;
    let delay = PREVIEW_MIN_INTERVAL_MS;
    const snap = pendingSegmentsRef.current.size === 0 ? chunker.peek() : null;
    if (snap) {
      const t0 = performance.now();
      const text = await transcribePartial(snap.audio).catch(() => null);
      delay = Math.max(PREVIEW_MIN_INTERVAL_MS, (performance.now() - t0) * 1.5);
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
      onSegment: (audio, phraseId) => {
        lastEmittedPhraseRef.current = phraseId;
        const job = transcribeSegment(audio)
          .then(appendFinal) // one chat bubble per phrase
          .catch((err) => console.error("Moonshine transcription error:", err))
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
    previewTimerRef.current = setTimeout(previewTick, PREVIEW_MIN_INTERVAL_MS);
    patch({ statusMsg: "Recording…", isRecording: true });
  };

  // ---- Start / stop ------------------------------------------------------
  const cleanupMedia = () => {
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

  const stop = useCallback(async () => {
    wantRecordingRef.current = false;
    chunkerRef.current?.flush(); // send the phrase that was mid-way when Stop was tapped
    cleanupMedia();
    patch({ isRecording: false, interimText: "", micLevel: 0, noSound: false, statusMsg: "Stopped. Saving…" });
    // Wait for the device to finish transcribing the last phrases.
    if (pendingSegmentsRef.current.size) patch({ statusMsg: "Finishing transcription…" });
    await Promise.all([...pendingSegmentsRef.current]);
    await save("DONE");
    patch({ statusMsg: "Saved to your account.", liveStatus: null, backlog: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

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

  const start = useCallback(async (source: AudioSource = "mic") => {
    const useSample = source === "sample";
    partsRef.current = [];
    secondsRef.current = 0;
    dirtyRef.current = false;
    speakingRef.current = false;
    pendingSegmentsRef.current.clear();
    patch({
      transcriptParts: [], interimText: "", liveStatus: null, backlog: 0, micLevel: 0, noSound: false,
      recordingSeconds: 0,
      statusMsg: useSample ? "Loading sample audio…" : "Requesting microphone…", saveState: "idle", meetingId: null,
    });

    // The audio context is created before any await so it counts as part of the tap
    // (iOS only allows audio to start then).
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    moonCtxRef.current = ctx;
    ctx.resume().catch(() => {});

    try {
      const mic = useSample
        ? await createSampleStream(ctx)
        : await navigator.mediaDevices
            .getUserMedia({
              audio: {
                // A chosen mic (Windows PCs often have several, and the default can be a silent one).
                ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: false,
                autoGainControl: true,
              },
            })
            // Chosen mic unplugged, or constraints unsupported: fall back to the default mic.
            .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      streamsRef.current.push(mic);

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

      // First use downloads the model (tens of MB); after that it loads from the browser cache.
      patch({ statusMsg: "Loading speech model…" });
      await loadMoonshine((pct) => patch({ statusMsg: `Downloading speech model… ${pct}%` }), {
        onModelChange: () => {
          if (wantRecordingRef.current) {
            patch({ statusMsg: "Recording — switched to the faster model for this phone…" });
          }
        },
      });

      patch({ statusMsg: "Creating meeting…" });
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "en",
          deviceName: detectDeviceName(),
          ...(useSample
            ? { title: `Sample recording – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create meeting");
      meetingIdRef.current = data.meeting.id;
      patch({ meetingId: data.meeting.id, statusMsg: "Starting…" });

      wantRecordingRef.current = true;
      await acquireWakeLock();
      await startMoonshine();
      playSampleIfAny();

      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        patch({ recordingSeconds: secondsRef.current });
      }, 1000);
      autosaveRef.current = setInterval(() => save(), AUTOSAVE_MS);
    } catch (e) {
      wantRecordingRef.current = false;
      cleanupMedia();
      const err = e as { name?: string; message?: string };
      const msg =
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "Microphone access was denied. Allow microphone permission for this site, or tap “Try with sample audio”."
          : `Recording error: ${err?.message || "Unknown error"}`;
      patch({ statusMsg: msg, isRecording: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.captureSystemAudio, opts.deviceId, save]);

  // Save whatever we have if the page is closed mid-recording.
  useEffect(() => {
    const onUnload = () => { if (wantRecordingRef.current) save(); };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [save]);

  return { ...state, start, stop };
}
