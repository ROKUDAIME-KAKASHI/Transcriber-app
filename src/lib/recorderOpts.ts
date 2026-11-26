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

/** Whether sign-out must wait: a recording is starting, running or still being saved. */
export function recorderBusy(s: { isRecording: boolean; isStarting: boolean; finishing?: boolean }): boolean {
  return s.isRecording || s.isStarting || !!s.finishing;
}
