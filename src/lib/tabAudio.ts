// Pure helpers for recording an online call from a browser tab (laptops). No imports so node tests load it directly.

export type AudioSourceChoice = "mic" | "tab";

export interface TabAudioEnv {
  /** Running inside the Capacitor Android app. */
  native: boolean;
  userAgent: string;
  /** matchMedia("(pointer: coarse)").matches */
  coarsePointer: boolean;
  /** typeof navigator.mediaDevices?.getDisplayMedia === "function" */
  hasGetDisplayMedia: boolean;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Tablet|CriOS|FxiOS/i;

/** Tab audio is offered on laptop/desktop browsers that can share a tab; never in the app, on phones or tablets. */
export function tabAudioAvailable(env: TabAudioEnv): boolean {
  if (env.native) return false;
  if (!env.hasGetDisplayMedia) return false;
  if (env.coarsePointer) return false;
  if (MOBILE_UA.test(env.userAgent)) return false;
  return true;
}

/** Whether the selector should show: feature switch on and the browser can do it. */
export function showSourceSelector(flagOn: boolean, env: TabAudioEnv): boolean {
  return flagOn && tabAudioAvailable(env);
}

export type SupportedConstraints = Record<string, unknown> | null | undefined;

/**
 * Options for getDisplayMedia. Audio processing is off so the call sounds like the call. Each newer option
 * is only included if the browser lists it in getSupportedConstraints() (unknown options are ignored by
 * browsers, but this keeps the request clean and testable). The base (video + audio) is always sent.
 */
export function buildDisplayMediaOptions(supported: SupportedConstraints): Record<string, unknown> {
  const sup = supported ?? {};
  const audio: Record<string, unknown> = {};
  const flag = (k: string, v: unknown) => {
    if (sup[k] === true) audio[k] = v;
  };
  flag("echoCancellation", false);
  flag("noiseSuppression", false);
  flag("autoGainControl", false);
  flag("suppressLocalAudioPlayback", false);
  const opts: Record<string, unknown> = { video: true, audio: Object.keys(audio).length ? audio : true };
  // Chromium display-surface hints. They are not in getSupportedConstraints() on every version, so these
  // are sent as plain top-level options (ignored where unknown).
  opts.preferCurrentTab = false;
  opts.selfBrowserSurface = "exclude";
  opts.systemAudio = "include";
  opts.surfaceSwitching = "include";
  return opts;
}

/** Minimal shape so tests need no DOM. */
export interface TrackLike {
  kind?: string;
  readyState?: string;
}

export function audioTrackCount(tracks: ReadonlyArray<TrackLike>): number {
  return tracks.filter((t) => (t.kind ?? "audio") === "audio" && t.readyState !== "ended").length;
}

export const NO_TAB_AUDIO_MESSAGE = "No tab audio was shared. Choose the call's tab and tick 'Share tab audio'.";
export const SHARING_STOPPED_MESSAGE = "Sharing stopped — recording saved";
export const TAB_HINT = "Pick the Meet/Zoom/Teams tab and turn on 'Share tab audio'. Use headphones so voices aren't recorded twice.";
export const TAB_SPEAKER_NOTE = "Speaker labels work best with Cloud";

/** Message for a failed getDisplayMedia(). A dismissed picker is a normal answer, not an error. */
export function displayMediaErrorMessage(name: string | undefined): string {
  if (name === "NotAllowedError" || name === "AbortError" || name === "PermissionDeniedError") {
    return "Sharing was cancelled. Pick the call's tab and tick 'Share tab audio' to record it.";
  }
  if (name === "NotSupportedError" || name === "TypeError") return "This browser can't share tab audio. Use Chrome or Edge on a laptop.";
  if (name === "NotFoundError") return "Nothing to share was found. Open the call in a browser tab and try again.";
  return "Couldn't capture the tab. Try again, or use the microphone.";
}

/** The source to start with: a plan with a call link defaults to the tab (when available), otherwise the saved choice. */
export function defaultSource(opts: { available: boolean; callUrl: string | null | undefined; saved: AudioSourceChoice | null }): AudioSourceChoice {
  if (!opts.available) return "mic";
  if (opts.callUrl) return "tab";
  return opts.saved === "tab" ? "tab" : "mic";
}

/** A call link safe to open: http(s) only. */
export function safeCallUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
