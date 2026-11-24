/**
 * Streaming resampler to 16 kHz for speech recognition.
 *
 * Mics usually deliver 44.1 or 48 kHz. Dropping to 16 kHz by plain interpolation folds
 * everything above 8 kHz back into the speech band (aliasing), which smears consonants like
 * "s", "f" and "t" — exactly the sounds that tell words apart. This low-pass filters first
 * (windowed-sinc, cutoff 7.2 kHz), keeps filter state between chunks so phrase boundaries
 * stay clean, and removes DC offset / mains hum below ~80 Hz.
 */
export const TARGET_RATE = 16000;

const CUTOFF_HZ = 7200;
const HALF_WIDTH = 24; // kernel half-width in output samples (≈1.5 ms)
const TABLE_RES = 64; // kernel table entries per input sample
const HIGHPASS_POLE = 0.969; // ≈80 Hz at 16 kHz

export class Resampler {
  private readonly ratio: number;
  private readonly halfWidthIn: number;
  private readonly table: Float32Array;
  private readonly tableScale: number;

  private buf = new Float32Array(0);
  private bufStart = 0; // absolute input index of buf[0]
  private pos = 0; // absolute input position of the next output sample
  private hpX = 0;
  private hpY = 0;

  readonly inputRate: number;

  constructor(inputRate: number) {
    this.inputRate = inputRate;
    this.ratio = inputRate / TARGET_RATE;
    if (this.ratio <= 1) {
      // Already 16 kHz (or lower): no filtering needed.
      this.halfWidthIn = 0;
      this.table = new Float32Array(1);
      this.tableScale = 0;
      return;
    }
    const fc = CUTOFF_HZ / inputRate; // cycles per input sample
    this.halfWidthIn = Math.ceil(HALF_WIDTH * this.ratio);
    const n = this.halfWidthIn * TABLE_RES + 1;
    this.table = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = i / TABLE_RES; // distance in input samples
      const x = 2 * fc * d;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = d / this.halfWidthIn;
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
      this.table[i] = 2 * fc * sinc * blackman;
    }
    this.tableScale = TABLE_RES;
  }

  /** Feeds one chunk at the input rate; returns the 16 kHz samples it completes. */
  process(input: Float32Array): Float32Array {
    const out = this.ratio <= 1 ? input.slice() : this.filter(input);
    // One-pole high-pass: removes DC offset and hum that would otherwise raise the noise floor.
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      const y = x - this.hpX + HIGHPASS_POLE * this.hpY;
      this.hpX = x;
      this.hpY = y;
      out[i] = y;
    }
    return out;
  }

  private filter(input: Float32Array): Float32Array {
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;

    const W = this.halfWidthIn;
    const end = this.bufStart + this.buf.length; // first absolute index not yet received
    const outCount = Math.max(0, Math.floor((end - W - this.pos) / this.ratio));
    const out = new Float32Array(outCount);
    const t = this.table;
    const s = this.tableScale;

    for (let o = 0; o < outCount; o++) {
      const center = this.pos - this.bufStart;
      const lo = Math.max(0, Math.ceil(center - W));
      const hi = Math.min(this.buf.length - 1, Math.floor(center + W));
      let acc = 0;
      for (let k = lo; k <= hi; k++) {
        const ti = Math.abs(center - k) * s;
        const i0 = ti | 0;
        const f = ti - i0;
        const coeff = i0 + 1 < t.length ? t[i0] + (t[i0 + 1] - t[i0]) * f : t[i0];
        acc += this.buf[k] * coeff;
      }
      out[o] = acc;
      this.pos += this.ratio;
    }

    // Keep only the history the next chunk's first outputs still need.
    const keepFrom = Math.max(0, Math.floor(this.pos - W) - this.bufStart);
    if (keepFrom > 0) {
      this.buf = this.buf.slice(keepFrom);
      this.bufStart += keepFrom;
    }
    return out;
  }
}
