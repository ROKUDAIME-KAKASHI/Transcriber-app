/// <reference lib="webworker" />
/**
 * Runs speech-to-text entirely on the device, off the main thread.
 *
 * Two model families:
 *  - Moonshine (English only): fast and small. Base ~63 MB, Tiny ~28 MB for slow phones.
 *  - Whisper Base (multilingual, ~77 MB): copes better with Indian-accented English and
 *    understands Hindi. Slower, because Whisper always encodes a full 30-second window,
 *    however short the phrase.
 *
 * Messages in:
 *   { type: "load", model: ModelName, language?: string, slowRtf?: number }
 *   { type: "transcribe", id, audio, kind: "final" | "partial" }   audio = 16 kHz mono Float32Array
 * Messages out:
 *   { type: "progress", progress }            first-time download, 0–100
 *   { type: "ready", model, threads }
 *   { type: "result", id, text, rtf }         rtf = processing time ÷ audio length
 *   { type: "skipped", id }                   a partial was replaced by a newer one before it ran
 *   { type: "model", model }                  switched to a lighter model because the device was too slow
 *   { type: "error", id?, message }
 *
 * Scheduling (matters on phones): "final" jobs (finished phrases) always run first and in order.
 * "partial" jobs (live word-by-word previews of the phrase being spoken) run only when no final is
 * waiting, and only the newest one is kept — so a slow phone shows fewer previews but never falls
 * behind on the real transcript.
 */
import { env, pipeline, type ProgressInfo } from "@huggingface/transformers";
import { hasLoop } from "../lib/speech/cleanText";
import { MODELS, type ModelName } from "../lib/speech/models";

const SAMPLE_RATE = 16000;
/** Switch to the lighter model when finishing phrases takes longer than this fraction of real time. */
const DEFAULT_SLOW_RTF = 0.8;
const RTF_SAMPLES_BEFORE_DECIDING = 3;

type GenerateOptions = {
  max_new_tokens?: number;
  no_repeat_ngram_size?: number;
  language?: string;
  task?: "transcribe";
};
type Transcriber = ((audio: Float32Array, options?: GenerateOptions) => Promise<{ text: string } | { text: string }[]>) & {
  dispose?: () => Promise<void>;
};

type Job = { id: number; audio: Float32Array; kind: "final" | "partial" };
type InMessage =
  | { type: "load"; model: ModelName; language?: string; slowRtf?: number }
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
let active: ModelName = "moonshine-base";
/** Whisper only: "en", "hi", … or undefined to auto-detect per phrase. */
let language: string | undefined;
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
  const p = pipeline("automatic-speech-recognition", MODELS[name].repo, {
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

/** Frees models that aren't needed any more (switching Moonshine ↔ Whisper), to save phone memory. */
function unloadOthers(keep: ModelName[]) {
  for (const [name, p] of loaded) {
    if (keep.includes(name)) continue;
    loaded.delete(name);
    p.then((t) => t.dispose?.()).catch(() => {});
  }
}

/** Called after each finished phrase. If this device can't keep up, fetch the lighter model in the background. */
function trackSpeed(rtf: number) {
  const fallback = MODELS[active].fallback;
  if (!fallback || switching) return;
  rtfSamples.push(rtf);
  if (rtfSamples.length > 5) rtfSamples.shift();
  if (rtfSamples.length < RTF_SAMPLES_BEFORE_DECIDING) return;
  const avg = rtfSamples.reduce((a, b) => a + b, 0) / rtfSamples.length;
  if (avg <= slowRtf) return;

  switching = true;
  const from = active;
  // The current model keeps transcribing while the lighter one downloads.
  loadModel(fallback, false)
    .then(() => {
      active = fallback;
      unloadOthers([fallback]);
      self.postMessage({ type: "model", model: fallback });
    })
    .catch((err) => console.warn(`Could not load ${fallback}, staying on ${from}:`, err))
    .finally(() => { switching = false; rtfSamples = []; });
}

// ---- Transcription ---------------------------------------------------------------
function optionsFor(job: Job, seconds: number): GenerateOptions {
  const whisper = MODELS[active].family === "whisper";
  // Cap the output length to stop runaway repetition. English needs ~6.5 tokens per second of
  // speech; Hindi in Devanagari takes several times more tokens per word.
  const perSecond = whisper && language !== "en" ? 15 : 6.5;
  const cap = Math.min(440, Math.ceil(seconds * perSecond) + 8);
  // Live previews end mid-word, which makes models prone to looping, so they get a tighter cap
  // and no repeated 3-word runs. Finals keep normal settings so genuine repetitions survive.
  const opts: GenerateOptions =
    job.kind === "final"
      ? { max_new_tokens: cap }
      : { max_new_tokens: Math.max(8, Math.round(cap * 0.65)), no_repeat_ngram_size: 3 };
  if (whisper) {
    opts.task = "transcribe"; // never translate
    if (language) opts.language = language;
  }
  return opts;
}

async function run(job: Job) {
  try {
    const transcriber = await loadModel(active, false);
    const seconds = job.audio.length / SAMPLE_RATE;
    const t0 = performance.now();
    const options = optionsFor(job, seconds);
    const textOf = (o: Awaited<ReturnType<Transcriber>>) => ((Array.isArray(o) ? o[0]?.text : o.text) ?? "").trim();
    let text = textOf(await transcriber(job.audio, options));
    // Rarely, a final phrase gets stuck repeating itself (noise, a cough mid-word). Decoding it
    // again with repeated 3-word runs blocked almost always recovers the real sentence.
    if (job.kind === "final" && hasLoop(text)) {
      text = textOf(await transcriber(job.audio, { ...options, no_repeat_ngram_size: 3 }));
    }
    // Whisper pays for a 30 s window even on a 1 s phrase, so judge its speed on at least 2 s.
    const minSeconds = MODELS[active].family === "whisper" ? 2 : 0.5;
    const rtf = (performance.now() - t0) / 1000 / Math.max(seconds, minSeconds);
    self.postMessage({ type: "result", id: job.id, text, rtf });
    if (job.kind === "final") trackSpeed(rtf);
  } catch (err) {
    self.postMessage({ type: "error", id: job.id, message: String((err as Error)?.message ?? err) });
  }
}

// ---- Scheduling ------------------------------------------------------------------
const finals: Job[] = [];
let partial: Job | null = null;
let running = false;

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
    active = msg.model;
    language = msg.language && msg.language !== "auto" ? msg.language : undefined;
    if (msg.slowRtf) slowRtf = msg.slowRtf;
    rtfSamples = [];
    unloadOthers([active]);
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
