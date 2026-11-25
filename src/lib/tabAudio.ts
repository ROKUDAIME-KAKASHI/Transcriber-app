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

/** Chromium browsers (Chrome, Edge, Opera, Brave) can share a tab's sound. Firefox and Safari cannot. */
const CHROMIUM_UA = /(Chrome|Chromium|Edg|OPR)\//;

/** "Record an online call" needs tab audio, so it is only offered where tab audio exists: Chromium on desktop. */
export function guidedCallAvailable(env: TabAudioEnv): boolean {
  return tabAudioAvailable(env) && CHROMIUM_UA.test(env.userAgent);
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
  // Ask the picker to open on its tab list. A hint only: the user can still pick anything. Sent only where the browser lists it.
  const video: boolean | Record<string, unknown> = sup.displaySurface === true ? { displaySurface: "browser" } : true;
  const opts: Record<string, unknown> = { video, audio: Object.keys(audio).length ? audio : true };
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

export const NO_TAB_AUDIO_MESSAGE = "No computer sound was shared. Try again and turn on 'Share audio'.";
export const SHARING_STOPPED_MESSAGE = "Sharing stopped — recording saved";

/** Message for a failed getDisplayMedia(). A dismissed picker is a normal answer, not an error. */
export function displayMediaErrorMessage(name: string | undefined): string {
  if (name === "NotAllowedError" || name === "AbortError" || name === "PermissionDeniedError") {
    return "Sharing was cancelled. Try again, pick what to share and keep 'Share audio' on.";
  }
  if (name === "NotSupportedError" || name === "TypeError") return "This browser can't share computer sound. Use Chrome or Edge on a laptop.";
  if (name === "NotFoundError") return "Nothing to share was found. Try again.";
  return "Couldn't capture computer sound. Try again, or turn it off.";
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
