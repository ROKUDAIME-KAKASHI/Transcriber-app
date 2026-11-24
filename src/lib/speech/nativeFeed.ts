/**
 * Pure helpers for transcribing audio that the Android recorder captured to files
 * (MeetingRecorder.readAudio, 16 kHz mono s16le, base64). No imports, so node:test can load it.
 *
 * Sample indexes are absolute: sample 0 is the start of the meeting, pauses excluded, the same
 * clock as the native service's `seconds`.
 */

export const NATIVE_SAMPLE_RATE = 16000;
/** 40 ms: close to the web path's 2048 samples at 48 kHz, so the chunker's ms-based timings match. */
export const FEED_FRAME = 640;
/** Behind the recorder by more than this means "catching up" (previews off, paced by the worker). */
export const CATCH_UP_SAMPLES = 3 * NATIVE_SAMPLE_RATE;
/** Largest read the plugin accepts per call (30 s). */
export const MAX_READ_SAMPLES = 30 * NATIVE_SAMPLE_RATE;

/** Little-endian s16 PCM as base64 -> floats in [-1, 1). Returns an empty array for empty input. */
export function pcm16Base64ToFloat32(b64: string): Float32Array {
  if (!b64) return new Float32Array(0);
  const bin = atob(b64);
  const n = bin.length >> 1; // an odd trailing byte is ignored
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(2 * i);
    const hi = bin.charCodeAt(2 * i + 1);
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

export interface FeedFrame {
  /** Absolute sample index of samples[0]. */
  at: number;
  samples: Float32Array;
  /** Set when a pause ended right before this frame: call chunker.breakAt(at) before feeding it. */
  breakAt?: number;
}

/**
 * Cuts a block of audio starting at absolute sample `from` into FEED_FRAME frames. `breaks` are the
 * sample indexes where a pause began (audio at that index is the first after the pause): the block is
 * split there, so the frame after a break starts exactly on it and carries `breakAt`. Breaks outside
 * (from, from + length) are ignored (a break exactly at `from` is applied to the first frame).
 */
export function frameBlock(samples: Float32Array, from: number, breaks: readonly number[] = [], frame: number = FEED_FRAME): FeedFrame[] {
  const end = from + samples.length;
  const cuts = [...new Set(breaks)].filter((b) => b >= from && b < end).sort((a, b) => a - b);
  const frames: FeedFrame[] = [];
  let pos = from;
  let ci = 0;
  while (pos < end) {
    let stop = Math.min(pos + frame, end);
    let isBreak = false;
    if (ci < cuts.length && cuts[ci] === pos) {
      isBreak = true;
      ci++;
    }
    if (ci < cuts.length && cuts[ci] < stop) stop = cuts[ci];
    frames.push({ at: pos, samples: samples.subarray(pos - from, stop - from), breakAt: isBreak ? pos : undefined });
    pos = stop;
  }
  return frames;
}

/**
 * Samples up to which everything is safely in the transcript (so audio before it can be deleted and a
 * restart resumes from it): the read position, held back by the phrase being spoken and by phrases
 * sent to the worker whose text hasn't been stored yet.
 */
export function committedCursor(a: { readPos: number; openStart: number | null; inFlightStarts: Iterable<number> }): number {
  let c = a.readPos;
  if (a.openStart !== null && a.openStart < c) c = a.openStart;
  for (const s of a.inFlightStarts) if (s < c) c = s;
  return Math.max(0, c);
}

/** True when the page is far enough behind the recorder to switch to catch-up behaviour. */
export function isCatchingUp(head: number, readPos: number): boolean {
  return head - readPos > CATCH_UP_SAMPLES;
}

/** How much to read per pull: small and live, or big when catching up. */
export function readSizeFor(catchingUp: boolean): number {
  return (catchingUp ? 10 : 2) * NATIVE_SAMPLE_RATE;
}

/** "12 min" / "45 s" of audio, rounded the way people read it. */
export function describeAudio(samples: number): string {
  const sec = Math.max(0, samples) / NATIVE_SAMPLE_RATE;
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

/**
 * Status line while the transcript trails the recording. `rate` is audio seconds processed per wall
 * second (rolling, measured); with it the line also gives an estimate.
 */
export function catchUpText(behindSamples: number, rate?: number | null): string {
  if (behindSamples <= CATCH_UP_SAMPLES) return "";
  const base = `Catching up · ${describeAudio(behindSamples)} of audio left`;
  if (!rate || !isFinite(rate) || rate <= 0) return base;
  const etaSec = behindSamples / NATIVE_SAMPLE_RATE / rate;
  if (etaSec < 60) return `${base} (about ${Math.max(1, Math.round(etaSec))} s)`;
  return `${base} (about ${Math.round(etaSec / 60)} min)`;
}

/** Rolling "audio seconds processed per wall second", for catchUpText's estimate. */
export class RateMeter {
  private points: Array<[number, number]> = []; // [wallMs, samplesProcessed]
  private readonly windowMs: number;
  constructor(windowMs = 60000) {
    this.windowMs = windowMs;
  }
  add(nowMs: number, samplesProcessed: number) {
    this.points.push([nowMs, samplesProcessed]);
    while (this.points.length > 2 && nowMs - this.points[0][0] > this.windowMs) this.points.shift();
  }
  /** Audio seconds per wall second, or null until there are two points far enough apart. */
  rate(): number | null {
    if (this.points.length < 2) return null;
    const [t0, s0] = this.points[0];
    const [t1, s1] = this.points[this.points.length - 1];
    const dt = (t1 - t0) / 1000;
    if (dt < 2) return null;
    return (s1 - s0) / NATIVE_SAMPLE_RATE / dt;
  }
}

export interface NativeCapabilities {
  localCapture: boolean;
  /** 1 = old APK (no local capture), 2+ = has MeetingRecorder.capabilities(). 0 = not in the app. */
  version: number;
  segmentSamples?: number;
}

export const NO_NATIVE_CAPABILITIES: NativeCapabilities = { localCapture: false, version: 0 };

/**
 * Turns the outcome of MeetingRecorder.capabilities() into NativeCapabilities. Old APKs reject
 * (UNIMPLEMENTED), which means "version 1, no local capture"; so does any other failure.
 */
export function interpretCapabilities(result: unknown, failed = false): NativeCapabilities {
  if (failed || !result || typeof result !== "object") return { localCapture: false, version: 1 };
  const r = result as { localCapture?: unknown; version?: unknown; segmentSamples?: unknown };
  const version = typeof r.version === "number" ? r.version : 2;
  return {
    localCapture: r.localCapture === true,
    version,
    segmentSamples: typeof r.segmentSamples === "number" ? r.segmentSamples : undefined,
  };
}
