"use client";

// Tesseract.js adapter for the NameReader seam. Everything is self-hosted under /tesseract/ (see
// scripts/copy-tesseract.mjs): no CDN, nothing leaves the device. tesseract.js runs recognition in its own
// Web Worker, so the page never blocks. This file is only ever imported lazily (dynamic import), and only
// when the per-device opt-in is on.

import type { NameRead, NameReader } from "./reader";

const BASE = "/tesseract";

export async function createTesseractReader(): Promise<NameReader> {
  const { createWorker } = await import("tesseract.js");
  const origin = typeof location !== "undefined" ? location.origin : "";
  const worker = await createWorker("eng", 1 /* OEM.LSTM_ONLY */, {
    workerPath: `${origin}${BASE}/worker.min.js`,
    corePath: `${origin}${BASE}/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${origin}${BASE}/lang`,
    workerBlobURL: false,
    gzip: true,
    logger: () => {},
    errorHandler: () => {},
  });
  // One line of text; a tile label is never a paragraph.
  await worker.setParameters({ tessedit_pageseg_mode: "7" as never, preserve_interword_spaces: "1" });
  let disposed = false;
  return {
    id: "tesseract",
    async read(image: Blob): Promise<NameRead | null> {
      if (disposed) return null;
      const { data } = await worker.recognize(image);
      const text = (data.text ?? "").trim();
      if (!text) return null;
      return { text, confidence: Number.isFinite(data.confidence) ? data.confidence : 0 };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await worker.terminate();
      } catch {
        /* already gone */
      }
    },
  };
}
