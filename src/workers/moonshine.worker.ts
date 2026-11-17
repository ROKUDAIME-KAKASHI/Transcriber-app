/// <reference lib="webworker" />
/**
 * Runs Moonshine speech-to-text entirely on the device, off the main thread.
 *
 * Messages in:
 *   { type: "load", model?: "base" | "tiny", slowRtf?: number }
 *   { type: "transcribe", id, audio, kind: "final" | "partial" }   audio = 16 kHz mono Float32Array
 * Messages out:
 *   { type: "progress", progress }            first-time download, 0–100
 *   { type: "ready", model, threads }
 *   { type: "result", id, text, rtf }         rtf = processing time ÷ audio length
 *   { type: "skipped", id }                   a partial was replaced by a newer one before it ran
 *   { type: "model", model: "tiny" }          switched to Tiny because the device was too slow
 *   { type: "error", id?, message }
 *
 * Scheduling (matters on phones): "final" jobs (finished phrases) always run first and in order.
 * "partial" jobs (live word-by-word previews of the phrase being spoken) run only when no final is
 * waiting, and only the newest one is kept — so a slow phone shows fewer previews but never falls
 * behind on the real transcript.
 *
 * Model choice (measured on the JFK sample clip, laptop):
 *  - Base, 8-bit, CPU: ~63 MB, 0.2–1 s per phrase, word-perfect.  ← default
 *  - Tiny, 8-bit, CPU: ~28 MB, ~2× faster, but drops some short phrases. ← slow phones
 *  - Base on WebGPU: ~154 MB and slower per phrase, so not used.
 */
import { env, pipeline, type ProgressInfo } from "@huggingface/transformers";
import { hasLoop } from "../lib/moonshine/cleanText";

const MODELS = {
  base: "onnx-community/moonshine-base-ONNX",
  tiny: "onnx-community/moonshine-tiny-ONNX",
} as const;
type ModelName = keyof typeof MODELS;

const SAMPLE_RATE = 16000;
/** Switch to Tiny when finishing phrases takes longer than this fraction of real time, on average. */
const DEFAULT_SLOW_RTF = 0.8;
const RTF_SAMPLES_BEFORE_DECIDING = 3;

type Transcriber = (
  audio: Float32Array,
  options?: { max_new_tokens?: number; no_repeat_ngram_size?: number }
) => Promise<{ text: string } | { text: string }[]>;

type Job = { id: number; audio: Float32Array; kind: "final" | "partial" };
type InMessage =
  | { type: "load"; model?: ModelName; slowRtf?: number }
  | ({ type: "transcribe" } & Job);

// ---- Runtime setup -----------------------------------------------------------
// Serve the WASM runtime from our own origin (copied by scripts/copy-ort.mjs):
// the multi-threaded build spawns workers from this URL, which must be same-origin.
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = {
    mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", self.location.origin).href,
    wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", self.location.origin).href,
  };
  // Threads need cross-origin isolation (COOP/COEP headers in next.config.ts).
  // Leave a core free for the UI and audio capture; more than 4 rarely helps.
  const cores = self.navigator.hardwareConcurrency || 2;
  onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, cores - 1)) : 1;
}

// ---- Model loading -------------------------------------------------------------
const loaded = new Map<ModelName, Promise<Transcriber>>();
let active: ModelName = "base";
let slowRtf = DEFAULT_SLOW_RTF;
let rtfSamples: number[] = [];
let switching = false;

async function warmUp(t: Transcriber) {
  // The first inference allocates buffers and compiles kernels; doing it on a second of
  // silence now keeps the user's first real phrase from being the slow one.
  await t(new Float32Array(SAMPLE_RATE), { max_new_tokens: 2 }).catch(() => {});
}

function loadModel(name: ModelName, reportProgress: boolean): Promise<Transcriber> {
  const existing = loaded.get(name);
  if (existing) return existing;
  let lastPct = -1;
  const p = pipeline("automatic-speech-recognition", MODELS[name], {
    device: "wasm",
    dtype: "q8",
    progress_callback: (info: ProgressInfo) => {
      if (!reportProgress || info.status !== "progress_total") return;
      const pct = Math.round(info.progress);
      if (pct === lastPct) return; // fires per network chunk; only report whole-percent changes
      lastPct = pct;
      self.postMessage({ type: "progress", progress: pct });
    },
  }).then(async (t) => {
    const transcriber = t as unknown as Transcriber;
    await warmUp(transcriber);
    return transcriber;
  });
  loaded.set(name, p);
  p.catch(() => loaded.delete(name)); // allow a retry after a failed download
  return p;
}

/** Called after each finished phrase. If this device can't keep up with Base, fetch Tiny in the background. */
function trackSpeed(rtf: number) {
  if (active !== "base" || switching) return;
  rtfSamples.push(rtf);
  if (rtfSamples.length > 5) rtfSamples.shift();
  if (rtfSamples.length < RTF_SAMPLES_BEFORE_DECIDING) return;
  const avg = rtfSamples.reduce((a, b) => a + b, 0) / rtfSamples.length;
  if (avg <= slowRtf) return;

  switching = true;
  // Base keeps transcribing while Tiny downloads; new phrases use Tiny once it's ready.
  loadModel("tiny", false)
    .then(() => {
      active = "tiny";
      self.postMessage({ type: "model", model: "tiny" });
    })
    .catch((err) => console.warn("Could not load Tiny model, staying on Base:", err))
    .finally(() => { switching = false; rtfSamples = []; });
}

// ---- Scheduling ------------------------------------------------------------------
const finals: Job[] = [];
let partial: Job | null = null;
let running = false;

async function run(job: Job) {
  try {
    const transcriber = await loadModel(active, false);
    const seconds = job.audio.length / SAMPLE_RATE;
    const t0 = performance.now();
    // Moonshine emits up to ~6.5 tokens per second of speech; capping stops runaway repetition.
    // Live previews end mid-word, which makes the model prone to looping ("…for you and what
    // your country can do for you and…"), so they get a tighter cap and no repeated 3-word runs.
    // Final transcripts keep the normal settings so genuine repetitions in speech survive.
    const options =
      job.kind === "final"
        ? { max_new_tokens: Math.ceil(seconds * 6.5) + 8 }
        : { max_new_tokens: Math.ceil(seconds * 4) + 4, no_repeat_ngram_size: 3 };
    const textOf = (o: Awaited<ReturnType<Transcriber>>) => ((Array.isArray(o) ? o[0]?.text : o.text) ?? "").trim();
    let text = textOf(await transcriber(job.audio, options));
    // Rarely, a final phrase gets stuck repeating itself (noise, a cough mid-word). Decoding it
    // again with repeated 3-word runs blocked almost always recovers the real sentence.
    if (job.kind === "final" && hasLoop(text)) {
      text = textOf(await transcriber(job.audio, { ...options, no_repeat_ngram_size: 3 }));
    }
    const rtf = (performance.now() - t0) / 1000 / Math.max(seconds, 0.5);
    self.postMessage({ type: "result", id: job.id, text, rtf });
    if (job.kind === "final") trackSpeed(rtf);
  } catch (err) {
    self.postMessage({ type: "error", id: job.id, message: String((err as Error)?.message ?? err) });
  }
}

function pump() {
  if (running) return;
  const job = finals.shift() ?? partial;
  if (!job) return;
  if (job === partial) partial = null;
  running = true;
  run(job).finally(() => {
    running = false;
    pump();
  });
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === "load") {
    active = msg.model ?? "base";
    if (msg.slowRtf) slowRtf = msg.slowRtf;
    loadModel(active, true)
      .then(() => self.postMessage({ type: "ready", model: active, threads: onnx.wasm?.numThreads ?? 1 }))
      .catch((err) => self.postMessage({ type: "error", message: String(err?.message ?? err) }));
    return;
  }

  if (msg.type === "transcribe") {
    const job: Job = { id: msg.id, audio: msg.audio, kind: msg.kind };
    if (job.kind === "final") {
      finals.push(job);
    } else {
      if (partial) self.postMessage({ type: "skipped", id: partial.id }); // superseded by newer audio
      partial = job;
    }
    pump();
  }
};
