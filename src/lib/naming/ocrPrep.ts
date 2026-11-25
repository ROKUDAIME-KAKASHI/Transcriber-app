// Prepares a cropped name-label picture for OCR: grey, dark-on-light, stretched contrast. Works in place on
// RGBA data. Pure, erasable TypeScript only.

export interface MutableImg {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Output height (px) the label crop is scaled to before OCR: text this tall reads well. */
export const OCR_TARGET_HEIGHT = 72;

/** Scale factor that brings a crop of height `h` to the target (never below 1, never above 4). */
export function ocrScale(h: number): number {
  if (h <= 0) return 1;
  return Math.max(1, Math.min(4, OCR_TARGET_HEIGHT / h));
}

/** Grey, inverted when the label is light-on-dark (most call UIs), contrast stretched. Returns whether it inverted. */
export function prepareForOcr(img: MutableImg): { inverted: boolean } {
  const { data, width: W, height: H } = img;
  const n = W * H;
  if (n === 0) return { inverted: false };
  const luma = new Float32Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    luma[i] = l;
    sum += l;
  }
  const inverted = sum / n < 128;
  // 2nd and 98th percentile for the stretch.
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(luma[i])))]++;
  const at = (q: number) => {
    let acc = 0;
    const target = n * q;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const lo = at(0.02);
  const hi = Math.max(lo + 1, at(0.98));
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = ((luma[i] - lo) / (hi - lo)) * 255;
    v = Math.max(0, Math.min(255, v));
    if (inverted) v = 255 - v;
    data[p] = data[p + 1] = data[p + 2] = v;
    data[p + 3] = 255;
  }
  return { inverted };
}
