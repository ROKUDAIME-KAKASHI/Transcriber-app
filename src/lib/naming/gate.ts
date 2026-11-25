// Rate limiting for frame reads: at most one read every `minGapMs`, none while paused, none while one runs.
// Pure; the caller passes the clock. Erasable TypeScript only.

export const OCR_MIN_GAP_MS = 3000;

export interface Gate {
  lastAt: number | null;
  busy: boolean;
}

export function newGate(): Gate {
  return { lastAt: null, busy: false };
}

export function mayRead(g: Gate, now: number, opts: { paused: boolean; minGapMs?: number }): boolean {
  if (opts.paused || g.busy) return false;
  if (g.lastAt !== null && now - g.lastAt < (opts.minGapMs ?? OCR_MIN_GAP_MS)) return false;
  return true;
}

export function markStarted(g: Gate, now: number): void {
  g.busy = true;
  g.lastAt = now;
}

export function markDone(g: Gate): void {
  g.busy = false;
}
