/** Pure scheduling rules for speaker-embedding jobs (lowest priority in the speech worker). No imports. */
export type EmbedSkip = "short" | "backlog" | "queue" | "slow" | "unavailable" | "error" | "cancelled";

export const SAMPLE_RATE = 16000;
export const MIN_EMBED_SEC = 1;
export const MAX_EMBED_SEC = 6;
export const SLOW_EMBED_SEC = 3;
export const SLOW_EMBED_MS = 1500;
export const BACKLOG_SKIP = 2;
export const MAX_EMBED_QUEUE = 3;
export const BUSY_WINDOW_MS = 60000;
export const BUSY_SLOW_FRACTION = 0.85;

/** Middle `maxSec` seconds of the audio as a copy; shorter audio is returned as-is. */
export function cropMiddle(a: Float32Array, maxSec: number, rate: number = SAMPLE_RATE): Float32Array {
  const max = Math.round(maxSec * rate);
  if (a.length <= max) return a;
  const start = Math.floor((a.length - max) / 2);
  return a.slice(start, start + max);
}

export function embedDecision(a: { seconds: number; finalsWaiting: number; speakerLoaded: boolean; slow: boolean }): "embed" | EmbedSkip {
  if (a.seconds < MIN_EMBED_SEC) return "short";
  if (!a.speakerLoaded) return "unavailable";
  if (a.finalsWaiting >= BACKLOG_SKIP) return "backlog";
  if (a.slow) return "slow";
  return "embed";
}

export function cropSecFor(lastEmbedMs: number | null, alreadySlow: boolean): number {
  if (alreadySlow || (lastEmbedMs !== null && lastEmbedMs > SLOW_EMBED_MS)) return SLOW_EMBED_SEC;
  return MAX_EMBED_SEC;
}

/** Fraction of the last `windowMs` that the worker spent busy, given [start, end] intervals in ms. */
export function busyFraction(intervals: Array<[number, number]>, now: number, windowMs: number = BUSY_WINDOW_MS): number {
  const from = now - windowMs;
  let sum = 0;
  for (const [s, e] of intervals) {
    const lo = Math.max(s, from);
    const hi = Math.min(e, now);
    if (hi > lo) sum += hi - lo;
  }
  return Math.min(1, sum / windowMs);
}
