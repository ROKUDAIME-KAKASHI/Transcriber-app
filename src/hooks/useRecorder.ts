"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";
import { loadMoonshine, transcribePartial, transcribeSegment } from "@/lib/moonshine/client";
import { VoiceChunker } from "@/lib/moonshine/voiceChunker";

/** "deepgram": cloud, live words, speaker labels, Indian languages. "moonshine": free, on-device, English. */
export type Engine = "deepgram" | "moonshine";

const AUTOSAVE_MS = 5000;

/**
 * "Try with sample audio": a short public-domain speech clip (JFK, 1961) fed into the
 * recorder instead of the microphone, so the engines can be seen working without a mic
 * (e.g. in browsers or embedded views that block microphone access).
 */
const SAMPLE_AUDIO_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

export type AudioSource = "mic" | "sample";
const MAX_RECONNECTS = 3;

type DeepgramWord = { speaker?: number };
type DeepgramMessage = {
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
};

export interface RecorderState {
  isRecording: boolean;
  meetingId: string | null;
  transcriptParts: TranscriptPart[];
  interimText: string;
  recordingSeconds: number;
  statusMsg: string;
  saveState: "idle" | "saving" | "saved" | "error";
}

async function fetchDeepgramToken(): Promise<{ token: string; subprotocol: string }> {
  const res = await fetch("/api/deepgram/token", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not get a Deepgram token.");
  return { token: data.token as string, subprotocol: (data.subprotocol as string) || "bearer" };
}

function pickMimeType(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
  }
  return undefined;
}

export function useRecorder(opts: { language: string; captureSystemAudio: boolean; engine: Engine }) {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    meetingId: null,
    transcriptParts: [],
    interimText: "",
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
  const reconnectsRef = useRef(0);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Moonshine (on-device) engine
  const chunkerRef = useRef<VoiceChunker | null>(null);
  const moonCtxRef = useRef<AudioContext | null>(null);
  const pendingSegmentsRef = useRef<Set<Promise<void>>>(new Set());
  const speakingRef = useRef(false);
  /** Live (not yet final) text per phrase id, shown greyed until the final version lands. */
  const previewsRef = useRef<Map<number, string>>(new Map());
  const lastEmittedPhraseRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const appendFinal = (speaker: number, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const prev = partsRef.current;
    const last = prev[prev.length - 1];
    partsRef.current =
      last && last.speaker === speaker
        ? [...prev.slice(0, -1), { speaker, text: `${last.text} ${clean}` }]
        : [...prev, { speaker, text: clean }];
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

  // ---- Deepgram socket ---------------------------------------------------
  const openSocket = useCallback(async () => {
    const recordStream = recordStreamRef.current;
    if (!recordStream) return;

    const { token, subprotocol } = await fetchDeepgramToken();
    const lang = opts.language;
    const modelParam = lang === "en" || lang === "hi" ? "model=nova-2&" : "";
    const url =
      `wss://api.deepgram.com/v1/listen?${modelParam}language=${lang}` +
      `&smart_format=true&punctuate=true&diarize=true&interim_results=true&utterance_end_ms=1000`;

    const socket = new WebSocket(url, [subprotocol, token]);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectsRef.current = 0;
      patch({ statusMsg: "Recording (live transcription)…", isRecording: true });
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();

      // A fresh MediaRecorder per socket so each connection gets a valid container header.
      const mimeOpts = pickMimeType();
      const recorder = mimeOpts ? new MediaRecorder(recordStream, mimeOpts) : new MediaRecorder(recordStream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(e.data);
      };
      recorder.start(200);
      recorderRef.current = recorder;
      playSampleIfAny();
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as DeepgramMessage;
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;
        if (data.is_final) {
          const speaker = alt.words?.find((w) => typeof w.speaker === "number")?.speaker ?? 0;
          if (alt.transcript) appendFinal(speaker, alt.transcript);
        } else {
          patch({ interimText: alt.transcript || "" });
        }
      } catch (err) {
        console.error("Deepgram parse error:", err);
      }
    };

    socket.onclose = (event) => {
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      if (!wantRecordingRef.current) return;

      // Unexpected drop (network blip, phone switching Wi-Fi → data): try to resume.
      if (reconnectsRef.current < MAX_RECONNECTS) {
        reconnectsRef.current += 1;
        patch({ statusMsg: `Connection lost — reconnecting (${reconnectsRef.current}/${MAX_RECONNECTS})…` });
        setTimeout(() => {
          if (wantRecordingRef.current) openSocket().catch(() => socket.onclose?.(event));
        }, 1000 * reconnectsRef.current);
      } else {
        patch({ statusMsg: `Connection closed (code ${event.code}). Transcript so far is saved.` });
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        stop();
      }
    };

    socket.onerror = (e) => console.error("Deepgram WebSocket error:", e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.language]);

  // ---- Moonshine (on-device) ---------------------------------------------
  const showMoonshineActivity = () => {
    const waiting = pendingSegmentsRef.current.size;
    const live = [...previewsRef.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t)
      .join(" ");
    // On slow phones phrases can queue up; say so instead of looking frozen.
    const backlog = waiting > 1 ? ` (${waiting} phrases waiting)` : "";
    patch({
      interimText: live
        ? `${live}${backlog}`
        : speakingRef.current
          ? "(listening…)"
          : waiting
            ? `(transcribing…${backlog})`
            : "",
    });
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

    const chunker = new VoiceChunker(ctx, {
      onSpeechChange: (speaking) => {
        speakingRef.current = speaking;
        showMoonshineActivity();
      },
      onSegment: (audio, phraseId) => {
        lastEmittedPhraseRef.current = phraseId;
        const job = transcribeSegment(audio)
          .then((text) => appendFinal(0, text))
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
    patch({ statusMsg: "Recording (on-device, English)…", isRecording: true });
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
    const usingMoonshine = !!chunkerRef.current;
    chunkerRef.current?.flush(); // send the phrase that was mid-way when Stop was tapped
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" })); // flush final words
      setTimeout(() => socket.close(), 1500);
    }
    cleanupMedia();
    patch({ isRecording: false, interimText: "", statusMsg: "Stopped. Saving…" });
    if (usingMoonshine) {
      // Wait for the device to finish transcribing the last phrases.
      if (pendingSegmentsRef.current.size) patch({ statusMsg: "Finishing transcription…" });
      await Promise.all([...pendingSegmentsRef.current]);
    } else {
      // Give Deepgram a moment to deliver the last final segment before saving.
      await new Promise((r) => setTimeout(r, 1600));
    }
    await save("DONE");
    patch({ statusMsg: "Saved to your account." });
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
    reconnectsRef.current = 0;
    speakingRef.current = false;
    pendingSegmentsRef.current.clear();
    patch({
      transcriptParts: [], interimText: "", recordingSeconds: 0,
      statusMsg: useSample ? "Loading sample audio…" : "Requesting microphone…", saveState: "idle", meetingId: null,
    });

    const useMoonshine = opts.engine === "moonshine";
    // Audio contexts are created before any await so they count as part of the tap
    // (iOS only allows audio to start then).
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (useMoonshine) {
      moonCtxRef.current = new Ctx();
      moonCtxRef.current.resume().catch(() => {});
    } else if (useSample) {
      audioCtxRef.current = new Ctx();
      audioCtxRef.current.resume().catch(() => {});
    }

    try {
      const mic = useSample
        ? await createSampleStream((moonCtxRef.current ?? audioCtxRef.current)!)
        : await navigator.mediaDevices
            .getUserMedia({
              audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
            })
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

      if (useMoonshine) {
        // First use downloads the model (tens of MB); after that it loads from the browser cache.
        patch({ statusMsg: "Loading on-device speech model…" });
        await loadMoonshine((pct) => patch({ statusMsg: `Downloading speech model… ${pct}%` }), {
          onModelChange: () => {
            if (wantRecordingRef.current) {
              patch({ statusMsg: "Recording (on-device, English) — switched to the faster model for this phone…" });
            }
          },
        });
      }

      patch({ statusMsg: "Creating meeting…" });
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: useMoonshine ? "en" : opts.language,
          deviceName: detectDeviceName(),
          ...(useSample
            ? { title: `Sample recording – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create meeting");
      meetingIdRef.current = data.meeting.id;
      patch({ meetingId: data.meeting.id, statusMsg: useMoonshine ? "Starting…" : "Connecting to Deepgram…" });

      wantRecordingRef.current = true;
      await acquireWakeLock();
      if (useMoonshine) {
        await startMoonshine();
        playSampleIfAny();
      } else {
        await openSocket(); // the sample starts playing once the Deepgram socket is open
      }

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
  }, [opts.language, opts.captureSystemAudio, opts.engine, openSocket, save]);

  // Save whatever we have if the page is closed mid-recording.
  useEffect(() => {
    const onUnload = () => { if (wantRecordingRef.current) save(); };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [save]);

  return { ...state, start, stop };
}
