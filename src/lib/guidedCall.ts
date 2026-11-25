// Pure logic for the guided "Record an online call" flow (laptops). Imports only tabAudio so node tests load it directly.
import { safeCallUrl } from "./tabAudio.ts";

// ---- What was shared -------------------------------------------------------------------------------------

export type ShareProblemCode = "window" | "screen" | "no-audio" | "cancelled";

/** Where the browser says the share comes from (track.getSettings().displaySurface). */
export type SurfaceKind = "tab" | "window" | "screen" | "unknown";

export function surfaceKind(displaySurface: unknown): SurfaceKind {
  if (displaySurface === "browser") return "tab";
  if (displaySurface === "window") return "window";
  if (displaySurface === "monitor") return "screen";
  return "unknown"; // older browsers don't say: trust the audio check instead
}

/** The first thing wrong with what the user shared, or null when it can be recorded. */
export function checkShare(input: { displaySurface?: unknown; audioTracks: number }): ShareProblemCode | null {
  const kind = surfaceKind(input.displaySurface);
  if (kind === "window") return "window";
  if (kind === "screen") return "screen";
  if (input.audioTracks <= 0) return "no-audio";
  return null;
}

export interface ShareProblemCopy {
  title: string;
  fix: string;
}

export function shareProblemCopy(code: ShareProblemCode): ShareProblemCopy {
  switch (code) {
    case "window":
      return { title: "That was a window, not a tab", fix: "Choose the “Chrome Tab” (or “Tab”) option at the top, then pick the tab with your call." };
    case "screen":
      return { title: "That was your whole screen, not a tab", fix: "Choose the “Chrome Tab” (or “Tab”) option at the top, then pick the tab with your call." };
    case "no-audio":
      return { title: "No call sound was shared", fix: "Pick the tab with your call and keep “Also share tab audio” switched on before you click Share." };
    case "cancelled":
      return { title: "Sharing was cancelled", fix: "Pick the tab with your call and click Share when you are ready." };
  }
}

// ---- Silence while sharing -------------------------------------------------------------------------------

export interface SilenceConfig {
  /** Below this loudness (0 to 1 RMS) counts as silent. */
  rmsThreshold: number;
  /** Silent for this long before warning. */
  warnAfterMs: number;
}

export const CALL_SILENCE: SilenceConfig = { rmsThreshold: 0.0005, warnAfterMs: 8000 };

export interface SilenceState {
  quietSince: number | null;
  warning: boolean;
}

export const initialSilence = (): SilenceState => ({ quietSince: null, warning: false });

/** Root-mean-square loudness of one block of samples. */
export function rmsOf(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

/** One loudness reading in. Warns after enough silence in a row; clears at the first sound. Never stops anything. */
export function stepSilence(state: SilenceState, rms: number, nowMs: number, cfg: SilenceConfig = CALL_SILENCE): SilenceState {
  if (rms >= cfg.rmsThreshold) return state.quietSince === null && !state.warning ? state : { quietSince: null, warning: false };
  const quietSince = state.quietSince ?? nowMs;
  const warning = state.warning || nowMs - quietSince >= cfg.warnAfterMs;
  return quietSince === state.quietSince && warning === state.warning ? state : { quietSince, warning };
}

export const CALL_SILENT_MESSAGE =
  "We can't hear the call yet. Check the call isn't muted, or share again and keep “Also share tab audio” on.";

// ---- Call links -------------------------------------------------------------------------------------------

/** A call link that is safe to open from here: https only. */
export function openableCallUrl(raw: string | null | undefined): string | null {
  const u = safeCallUrl(raw);
  return u && u.startsWith("https://") ? u : null;
}

export interface CallPlatform {
  id: "meet" | "teams" | "zoom";
  name: string;
  /** An extra plain-words tip for this platform. */
  hint?: string;
}

const HOSTS: Array<{ id: CallPlatform["id"]; name: string; hint?: string; domains: string[] }> = [
  { id: "meet", name: "Google Meet", domains: ["meet.google.com"] },
  { id: "teams", name: "Microsoft Teams", domains: ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"] },
  {
    id: "zoom",
    name: "Zoom",
    hint: "On Zoom, choose “Join from your browser”. The Zoom app can't be shared as a tab.",
    domains: ["zoom.us", "zoom.com"],
  },
];

export function detectCallPlatform(raw: string | null | undefined): CallPlatform | null {
  const url = openableCallUrl(raw);
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const p of HOSTS) {
    if (p.domains.some((d) => host === d || host.endsWith("." + d))) return { id: p.id, name: p.name, hint: p.hint };
  }
  return null;
}

// ---- "Don't show the guide again" (per device) ----------------------------------------------------------

export const GUIDE_HIDDEN_KEY = "minutely.callGuideHidden";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function guideHidden(store: KeyValueStore | null | undefined): boolean {
  try {
    return store?.getItem(GUIDE_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuideHidden(store: KeyValueStore | null | undefined, hidden: boolean): void {
  try {
    if (hidden) store?.setItem(GUIDE_HIDDEN_KEY, "1");
    else store?.removeItem(GUIDE_HIDDEN_KEY);
  } catch {
    /* storage blocked: the guide just shows again */
  }
}
