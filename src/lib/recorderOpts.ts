/** Pure helpers for the app-level recorder (RecorderProvider). Kept free of React so they can be tested. */

export interface RecorderOptsLike {
  engine: string;
  language: string;
  deviceId?: string;
  source?: string;
  naming?: unknown;
}

/** Same settings? Used to skip a provider re-render when the Record screen pushes unchanged options. */
export function sameRecorderOpts(a: RecorderOptsLike, b: RecorderOptsLike): boolean {
  return (
    a.engine === b.engine &&
    a.language === b.language &&
    (a.deviceId ?? "") === (b.deviceId ?? "") &&
    (a.source ?? "mic") === (b.source ?? "mic") &&
    a.naming === b.naming
  );
}

/**
 * Settings are frozen while a recording is starting, running or finishing: the Record screen may be
 * closed and reopened mid-meeting, and a fresh screen must never change the running session's engine.
 */
export function nextRecorderOpts<T extends RecorderOptsLike>(current: T, pushed: T, busy: boolean): T {
  if (busy) return current;
  return sameRecorderOpts(current, pushed) ? current : pushed;
}

/**
 * Whether the recorder is busy: starting, recording (or paused), finishing a native capture, or still
 * saving. Sign-out, the settings freeze, the reload guards and the auth gate all use this one answer.
 */
export function recorderBusy(s: {
  isRecording: boolean;
  isStarting: boolean;
  finishing?: boolean;
  saveState?: string;
}): boolean {
  return s.isRecording || s.isStarting || !!s.finishing || s.saveState === "saving";
}

/** The app stays mounted (never the skeleton or login) while a recording is busy, whatever the session probe says. */
export function holdAppForRecording(decision: string, busy: boolean): boolean {
  return busy && decision !== "app" && decision !== "app-cached";
}
