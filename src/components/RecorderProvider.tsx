"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/hooks/useRecorder";
import { setWebRecording } from "@/lib/recordingFlag";
import { nextRecorderOpts, recorderBusy } from "@/lib/recorderOpts";

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
  /** Starting, recording or still saving. Read on demand (no subscription). */
  isBusy: () => boolean;
}

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
    }),
    []
  );

  // Back button / sign-in guard: a web recording is running.
  useEffect(() => {
    setWebRecording(rec.isRecording);
  }, [rec.isRecording]);
  useEffect(() => () => setWebRecording(false), []);

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={rec}>{children}</StateCtx.Provider>
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
