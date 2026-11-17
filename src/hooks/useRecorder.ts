"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";

const AUTOSAVE_MS = 5000;
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

async function fetchDeepgramToken(): Promise<string> {
  const res = await fetch("/api/deepgram/token", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not get a Deepgram token.");
  return data.token as string;
}

function pickMimeType(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
  }
  return undefined;
}

export function useRecorder(opts: { language: string; captureSystemAudio: boolean }) {
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

    const token = await fetchDeepgramToken();
    const lang = opts.language;
    const modelParam = lang === "en" || lang === "hi" ? "model=nova-2&" : "";
    const url =
      `wss://api.deepgram.com/v1/listen?${modelParam}language=${lang}` +
      `&smart_format=true&punctuate=true&diarize=true&interim_results=true&utterance_end_ms=1000`;

    const socket = new WebSocket(url, ["bearer", token]);
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

  // ---- Start / stop ------------------------------------------------------
  const cleanupMedia = () => {
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
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" })); // flush final words
      setTimeout(() => socket.close(), 1500);
    }
    cleanupMedia();
    patch({ isRecording: false, interimText: "", statusMsg: "Stopped. Saving…" });
    // Give Deepgram a moment to deliver the last final segment before saving.
    await new Promise((r) => setTimeout(r, 1600));
    await save("DONE");
    patch({ statusMsg: "Saved to your account." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  const start = useCallback(async () => {
    partsRef.current = [];
    secondsRef.current = 0;
    dirtyRef.current = false;
    reconnectsRef.current = 0;
    patch({
      transcriptParts: [], interimText: "", recordingSeconds: 0,
      statusMsg: "Requesting microphone…", saveState: "idle", meetingId: null,
    });

    try {
      const mic = await navigator.mediaDevices
        .getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
        })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      streamsRef.current.push(mic);

      let recordStream: MediaStream = mic;
      // System audio (Zoom/Teams tab) only exists on desktop browsers.
      if (opts.captureSystemAudio && navigator.mediaDevices.getDisplayMedia) {
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

      patch({ statusMsg: "Creating meeting…" });
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: opts.language, deviceName: detectDeviceName() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create meeting");
      meetingIdRef.current = data.meeting.id;
      patch({ meetingId: data.meeting.id, statusMsg: "Connecting to Deepgram…" });

      wantRecordingRef.current = true;
      await acquireWakeLock();
      await openSocket();

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
          ? "Microphone access was denied. Allow microphone permission for this site and try again."
          : `Recording error: ${err?.message || "Unknown error"}`;
      patch({ statusMsg: msg, isRecording: false });
    }
  }, [opts.language, opts.captureSystemAudio, openSocket, save]);

  // Save whatever we have if the page is closed mid-recording.
  useEffect(() => {
    const onUnload = () => { if (wantRecordingRef.current) save(); };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [save]);

  return { ...state, start, stop };
}
