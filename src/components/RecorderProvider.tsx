"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/hooks/useRecorder";
import { setWebRecording } from "@/lib/recordingFlag";
import { nextRecorderOpts, recorderBusy } from "@/lib/recorderOpts";
import { useFlag } from "@/lib/flagsClient";
import { enqueueAuto } from "@/lib/minutesJob";
import { useLocalUser } from "./SyncProvider";

type Opts = Parameters<typeof useRecorder>[0];
type Rec = ReturnType<typeof useRecorder>;

/** Stable for the whole session: reading it never re-renders a component. */
export interface RecorderActions {
  start: Rec["start"];
  stop: Rec["stop"];
  pause: Rec["pause"];
  resume: Rec["resume"];
  cancelStart: Rec["cancelStart"];
  renameSpeaker: Rec["renameSpeaker"];
  /** Record screen -> provider: engine, language, mic, source. Ignored while a recording is busy. */
  setOptions: (o: Opts) => void;
  getOptions: () => Opts;
  /** Starting, recording, paused, finishing or saving. Read on demand (no subscription). */
  isBusy: () => boolean;
  /** Record screen opened: hide a finished, saved recording so the screen starts fresh. No-op while busy. */
  resetFinished: () => void;
}

/** What a finished recording looks like once it has been put away. */
const BLANK = {
  meetingId: null, transcriptParts: [], interimText: "", liveStatus: null, backlog: 0, micLevel: 0,
  noSound: false, recordingSeconds: 0, isPaused: false, statusMsg: "Ready", saveState: "idle" as const,
  syncNote: null, stoppedRemotely: false, speakerNames: null, notice: null, finishing: false,
  callSilent: false, screenNaming: null,
};

const DEFAULT_OPTS: Opts = { engine: "moonshine", language: "en", deviceId: "", source: "mic" };

const ActionsCtx = createContext<RecorderActions | null>(null);
/** Changes with every transcript tick and timer second: subscribe only where it is shown. */
const StateCtx = createContext<Rec | null>(null);

/**
 * Owns the one on-device/web recorder for the whole signed-in app, so recording carries on while the
 * user moves between pages. It only unmounts on a full page unload (the hook's pagehide autosave and
 * the next start's orphan recovery still cover reloads and closed tabs).
 */
export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Opts>(DEFAULT_OPTS);
  const rec = useRecorder(opts);
  const recRef = useRef(rec);
  recRef.current = rec;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { userId } = useLocalUser();
  /** The meeting a fresh Record screen should no longer show. */
  const [putAway, setPutAway] = useState<string | null>(null);

  const actions = useMemo<RecorderActions>(
    () => ({
      start: (...a) => recRef.current.start(...a),
      stop: () => recRef.current.stop(),
      pause: () => recRef.current.pause(),
      resume: () => recRef.current.resume(),
      cancelStart: () => recRef.current.cancelStart(),
      renameSpeaker: (...a) => recRef.current.renameSpeaker(...a),
      setOptions: (o) => setOpts((cur) => nextRecorderOpts(cur, o, recorderBusy(recRef.current))),
      getOptions: () => optsRef.current,
      isBusy: () => recorderBusy(recRef.current),
      resetFinished: () => {
        const r = recRef.current;
        if (recorderBusy(r) || !r.meetingId) return;
        if (r.saveState === "saved" || r.saveState === "local") setPutAway(r.meetingId);
      },
    }),
    []
  );

  // Back button / reload / sign-in guard: a web recording is starting, running or still saving.
  const busy = recorderBusy(rec);
  useEffect(() => {
    setWebRecording(busy);
  }, [busy]);
  useEffect(() => () => setWebRecording(false), []);

  // The account a session started under (WR-07). Captured when it becomes busy, kept until the next one.
  const ownerRef = useRef<string | null>(null);
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (busy && !wasBusyRef.current) ownerRef.current = userId;
    wasBusyRef.current = busy;
  }, [busy, userId]);
  // Signed in as someone else mid-recording: stop it (the hook keeps saving under the original account).
  const userChanged = !!userId && !!ownerRef.current && userId !== ownerRef.current;
  useEffect(() => {
    if (userChanged && rec.isRecording) void recRef.current.stop().catch(() => {});
  }, [userChanged, rec.isRecording]);

  // Stop -> write the minutes for this meeting once (queued; the runner waits for internet and sign-in).
  // Lives here so it happens wherever the recording ends, not only while Record is open.
  const autoMinutesOn = useFlag("autoMinutes");
  const queuedMeeting = useRef<string | null>(null);
  const finished =
    !busy && !!rec.meetingId && rec.transcriptParts.length > 0 && (rec.saveState === "saved" || rec.saveState === "local");
  const words = useMemo(
    () => rec.transcriptParts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    [rec.transcriptParts]
  );
  useEffect(() => {
    const owner = ownerRef.current ?? userId; // never the new account when the session started under another
    if (!finished || !autoMinutesOn || !owner || !rec.meetingId || queuedMeeting.current === rec.meetingId) return;
    // Remembered only once queued, so late final phrases that push the count past the minimum still get a run.
    if (enqueueAuto(owner, rec.meetingId, words)) queuedMeeting.current = rec.meetingId;
  }, [finished, autoMinutesOn, userId, rec.meetingId, words]);

  // A finished recording is put away on request, and never shown to a different account.
  const hide = !busy && !!rec.meetingId && (rec.meetingId === putAway || userChanged);
  const view = useMemo<Rec>(() => (hide ? { ...rec, ...BLANK } : rec), [rec, hide]);

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={view}>{children}</StateCtx.Provider>
    </ActionsCtx.Provider>
  );
}

/** Null outside the provider (e.g. the login page). */
export function useRecorderActions(): RecorderActions | null {
  return useContext(ActionsCtx);
}

/** The live recorder state. Subscribes to every tick: use only on the Record screen and the pill. */
export function useRecorderState(): Rec {
  const v = useContext(StateCtx);
  if (!v) throw new Error("useRecorderState needs <RecorderProvider>");
  return v;
}

/** Same, but null outside the provider. */
export function useRecorderStateOptional(): Rec | null {
  return useContext(StateCtx);
}
