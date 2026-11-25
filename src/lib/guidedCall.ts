// Pure logic for recording computer sound next to the mic (laptops): silence warning and call-platform detection. Imports only tabAudio so node tests load it directly.
import { safeCallUrl } from "./tabAudio.ts";

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
  "We can't hear the call yet. Check the call isn't muted and that “Share audio” was on when you picked what to share.";

// ---- Call links -------------------------------------------------------------------------------------------

/** A call link that is safe to open from here: https only. */
export function openableCallUrl(raw: string | null | undefined): string | null {
  const u = safeCallUrl(raw);
  if (!u || !u.startsWith("https://")) return null;
  try {
    const parsed = new URL(u);
    // A link with a user name or password is never a real call link (and can disguise the host).
    if (parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return u;
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
