// Pure ducking decision for "Also record computer sound". No imports so node tests load it directly.
// When the call is loud, the mic is turned down so laptop speakers are not recorded a second time through the mic.

/** Computer-sound loudness (0 to 1 RMS) above which someone on the call is speaking. */
export const DUCK_THRESHOLD = 0.01;
/** How long the mic stays down after the call goes quiet. */
export const DUCK_HOLD_MS = 300;
/** Mic gain while ducked: about -20 dB. */
export const DUCK_GAIN = 0.1;
/** setTargetAtTime time constants (seconds): down fast, back up over about 100 ms. */
export const DUCK_FALL_TC = 0.01;
export const DUCK_RISE_TC = 0.03;

export interface DuckState {
  /** When the call was last above the threshold (ms), or null. */
  lastLoudAt: number | null;
  ducked: boolean;
}

export interface DuckConfig {
  threshold: number;
  holdMs: number;
}

export const DUCK_CONFIG: DuckConfig = { threshold: DUCK_THRESHOLD, holdMs: DUCK_HOLD_MS };

export const initialDuck = (): DuckState => ({ lastLoudAt: null, ducked: false });

/** One loudness reading in: ducked while the call is loud, and for holdMs after it was last loud. */
export function stepDuck(state: DuckState, rms: number, nowMs: number, cfg: DuckConfig = DUCK_CONFIG): DuckState {
  const lastLoudAt = rms >= cfg.threshold ? nowMs : state.lastLoudAt;
  const ducked = lastLoudAt !== null && nowMs - lastLoudAt <= cfg.holdMs;
  return lastLoudAt === state.lastLoudAt && ducked === state.ducked ? state : { lastLoudAt, ducked };
}
