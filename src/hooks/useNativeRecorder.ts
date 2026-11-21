"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceName, type TranscriptPart } from "@/lib/transcript";
import { MeetingRecorder, isNativeApp, type NativeRecorderState } from "@/lib/nativeRecorder";
import type { AudioSource, RecorderState } from "./useRecorder";
import { useLocalUser } from "@/components/SyncProvider";
import { applySyncResult, createLocal, mirrorNative, purge } from "@/lib/local/repo";
import { newMeetingId } from "@/lib/local/ids";

/** The service autosaves to the server itself; JS only copies its parts to the device at most this often. */
const MIRROR_MS = 5000;

/** How often the Record screen reads the native recorder's state while it's on screen. */
const POLL_MS = 250;

const initial: RecorderState = {
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
};

/**
 * Same interface as useRecorder, backed by the Android app's foreground-service recorder.
 * Recording carries on when this screen is left or the phone is locked; coming back re-attaches
 * to it (including after the app was closed and reopened from the notification).
 */
export function useNativeRecorder(opts: { language: string }) {
  const [state, setState] = useState<RecorderState>(initial);
  const partsRef = useRef<TranscriptPart[]>([]);
  const startingRef = useRef(false);
  /** The native session this screen shows (a finished one stays shown until a new start). */
  const meetingRef = useRef<string | null>(null);
  const finishingRef = useRef(false);
  const { userId, available } = useLocalUser();
  const localUserRef = useRef({ userId, available });
  localUserRef.current = { userId, available };
  const lastMirrorRef = useRef(0);
  const mirroredFinalRef = useRef<string | null>(null); // meeting id whose final state is mirrored

  const patch = (p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p }));

  const apply = useCallback((n: NativeRecorderState) => {
    if (!n.meetingId) return;
    // A different meeting than the one shown (e.g. reopened the app mid-recording): start over.
    if (n.meetingId !== meetingRef.current) {
      // While starting, only the new meeting counts; otherwise only a running one (not an old finished one).
      if (startingRef.current || !n.active) return;
      meetingRef.current = n.meetingId;
      partsRef.current = [];
      if (n.from > 0) return; // next poll fetches from 0
    }
    // Only swap the array when something changed, so the transcript doesn't re-render 4× a second.
    const cur = partsRef.current;
    const changed =
      n.from + n.parts.length !== cur.length ||
      n.parts.some((p, i) => {
        const c = cur[n.from + i];
        return !c || c.text !== p.text || c.speaker !== p.speaker;
      });
    if (changed) partsRef.current = cur.slice(0, n.from).concat(n.parts);
    finishingRef.current = n.finishing;
    // Mirror the service's transcript into the device store (read-only copy: the service is the server writer).
    const lu = localUserRef.current;
    if (lu.userId && lu.available && n.meetingId && (n.finished ? mirroredFinalRef.current !== n.meetingId : Date.now() - lastMirrorRef.current > MIRROR_MS)) {
      lastMirrorRef.current = Date.now();
      if (n.finished) mirroredFinalRef.current = n.meetingId;
      const uid = lu.userId;
      const mid = n.meetingId;
      const status = n.finished ? "DONE" : "RECORDING";
      const parts = partsRef.current;
      mirrorNative(uid, mid, parts, n.seconds, status)
        .then(async (ok) => {
          if (ok) return;
          // App reopened mid-recording with no local row: create one, then mirror again.
          const made = await createLocal(uid, {
            id: mid, title: "Meeting", language: opts.language, engine: "deepgram",
            deviceName: detectDeviceName(), origin: "native",
          });
          if (made) await mirrorNative(uid, mid, parts, n.seconds, status);
        })
        .catch(() => {});
    }
    const live = n.active && !n.paused && !n.finishing;
    // Running, or it failed to start (finished without ever running).
    if (n.active || n.finished) startingRef.current = false;
    setState((s) => ({
      ...s,
      isRecording: n.active,
      isStarting: startingRef.current,
      meetingId: n.meetingId,
      transcriptParts: partsRef.current,
      interimText: live ? n.interim : "",
      liveStatus: live && !n.interim ? "listening" : null,
      backlog: 0,
      micLevel: live ? n.level : 0,
      noSound: live && n.noSound,
      recordingSeconds: n.seconds,
      isPaused: n.paused,
      statusMsg: n.status,
      saveState: n.saveState,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the recorder's state while this screen is visible.
  useEffect(() => {
    if (!isNativeApp()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          // The last phrase can still grow: always re-read it.
          const from = Math.max(0, partsRef.current.length - 1);
          apply(await MeetingRecorder.getState({ from }));
        } catch {
          /* bridge busy: try again next tick */
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [apply]);

  const start = useCallback(async (_source: AudioSource = "mic") => {
    if (startingRef.current || state.isRecording) return;
    startingRef.current = true;
    partsRef.current = [];
    meetingRef.current = null;
    setState({ ...initial, isStarting: true, statusMsg: "Creating meeting…" });
    const id = newMeetingId();
    const title = `Meeting – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
    const lu = localUserRef.current;
    const uid = lu.userId && lu.available ? lu.userId : null;
    try {
      // Best effort: a device copy exists even if the server is slow. The POST below stays awaited
      // (the service needs the server row before it starts patching it).
      if (uid) await createLocal(uid, { id, title, language: opts.language, engine: "deepgram", deviceName: detectDeviceName(), origin: "native" });
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          language: opts.language,
          engine: "deepgram",
          deviceName: detectDeviceName(),
          title,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.meeting) {
        if (uid) await purge(uid, id);
        throw new Error(
          res.status === 401 ? "You've been signed out. Sign in again." : data.error || `Could not create the meeting (error ${res.status}).`
        );
      }
      if (!startingRef.current) return; // cancelled
      meetingRef.current = data.meeting.id;
      if (uid) {
        if (data.meeting.id !== id) {
          // Server without client-id support assigned its own id: keep the device row under that id.
          await purge(uid, id);
          await createLocal(uid, { id: data.meeting.id, title, language: opts.language, engine: "deepgram", deviceName: detectDeviceName(), origin: "native" });
        }
        await applySyncResult(uid, data.meeting.id, { clear: ["create"] });
      }
      lastMirrorRef.current = 0;
      mirroredFinalRef.current = null;
      patch({ meetingId: data.meeting.id, statusMsg: "Starting the microphone…" });
      await MeetingRecorder.start({ meetingId: data.meeting.id, language: opts.language, baseUrl: window.location.origin });
      // The poll flips isStarting off once the service reports it's running.
    } catch (e) {
      startingRef.current = false;
      const msg = (e as { message?: string })?.message || "Unknown error";
      patch({
        isStarting: false,
        statusMsg: msg.startsWith("Failed to fetch") ? "Network problem — check the connection and try again." : msg,
      });
    }
  }, [opts.language, state.isRecording]);

  const stop = useCallback(async () => {
    // Tapping Stop again while it waits for the internet finishes without the unsent audio.
    await MeetingRecorder.stop({ force: finishingRef.current }).catch(() => {});
  }, []);
  const pause = useCallback(() => {
    MeetingRecorder.pause().catch(() => {});
  }, []);
  const resume = useCallback(() => {
    MeetingRecorder.resume().catch(() => {});
  }, []);
  const cancelStart = useCallback(() => {
    if (!startingRef.current) return;
    startingRef.current = false;
    MeetingRecorder.stop({ force: true }).catch(() => {});
    patch({ isStarting: false, statusMsg: "Cancelled" });
  }, []);

  return { ...state, start, stop, pause, resume, cancelStart };
}

/** Whether Android may stop the app to save battery (the main risk for very long meetings). */
export function useBatteryRestriction(enabled: boolean) {
  const [restricted, setRestricted] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = () =>
      MeetingRecorder.batteryStatus()
        .then((b) => setRestricted(!b.unrestricted))
        .catch(() => {});
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled]);
  const fix = useCallback(() => {
    MeetingRecorder.requestUnrestrictedBattery().catch(() => {});
  }, []);
  return { restricted, fix };
}
