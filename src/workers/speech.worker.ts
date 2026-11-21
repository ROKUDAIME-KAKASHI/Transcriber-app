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
 *   { type: "cache-status", model } -> { type: "cache-status", model, cached }
 *   { type: "prefetch", model, requestId } -> prefetch-progress / prefetched / error (with requestId)
 *   { type: "transcribe", id, audio, kind: "final" | "partial", embed?: boolean }   audio = 16 kHz mono Float32Array
 *   { type: "load-speaker", localOnly? }      load the speaker-embedding model (after ASR is ready)
 *   { type: "speaker-cache-status" } -> { type: "speaker-cache-status", cached }
 *   { type: "prefetch-speaker", requestId }   -> prefetch-progress / prefetched (model: "speaker") / error (with requestId)
 *   { type: "cancel-embeds" }                 queued embeddings are dropped (skipped: "cancelled")
 * Messages out:
 *   { type: "progress", progress }            first-time download, 0–100
 *   { type: "ready", model, threads }
 *   { type: "result", id, text, rtf }         rtf = processing time ÷ audio length
 *   { type: "skipped", id }                   a partial was replaced by a newer one before it ran
 *   { type: "model", model }                  switched to a lighter model because the device was too slow
 *   { type: "speaker-ready", ok }             speaker model loaded (ok false = unavailable; never an id-less error)
 *   { type: "embedding", id, vector?, skipped?, embedMs?, cropSec? }   exactly one per transcribe with embed: true
 *   { type: "error", id?, message }
 *
 * Scheduling (matters on phones): "final" jobs (finished phrases) always run first and in order.
 * "partial" jobs (live word-by-word previews of the phrase being spoken) run only when no final is
 * waiting, and only the newest one is kept — so a slow phone shows fewer previews but never falls
 * behind on the real transcript. Speaker embeddings are a third, lowest class: they run only when no
 * final and no partial is waiting, and are skipped (never queued deeper) when the worker is behind.
 */
import { env, pipeline, ModelRegistry, AutoFeatureExtractor, AutoModel, type ProgressInfo } from "@huggingface/transformers";
import { hasLoop } from "../lib/speech/cleanText";
import { MODELS, SPEAKER_MODEL, type ModelName } from "../lib/speech/models";
import {
  BUSY_SLOW_FRACTION,
  BUSY_WINDOW_MS,
  MAX_EMBED_QUEUE,
  SLOW_EMBED_MS,
  busyFraction,
  cropMiddle,
  cropSecFor,
  embedDecision,
  type EmbedSkip,
} from "../lib/speech/embedSchedule";

const SAMPLE_RATE = 16000;
/**
 * Switch to the lighter (less accurate) model only when finishing phrases is slower than real time.
 * The first phrases after loading are ignored: phones are often slow then (cold JIT, thermal
 * ramp-up), and judging on them used to push phones onto Tiny for no lasting reason.
 */
const DEFAULT_SLOW_RTF = 1.0;
const RTF_SAMPLES_BEFORE_DECIDING = 4;
const WARMUP_PHRASES_IGNORED = 2;

type GenerateOptions = {
  max_new_tokens?: number;
  no_repeat_ngram_size?: number;
  language?: string;
  task?: "transcribe";
};
type Transcriber = ((audio: Float32Array, options?: GenerateOptions) => Promise<{ text: string } | { text: string }[]>) & {
  dispose?: () => Promise<void>;
};

type Job = { id: number; audio: Float32Array; kind: "final" | "partial"; embed?: boolean };
type EmbedJob = { id: number; audio: Float32Array };
type SpeakerModel = {
  fe: (audio: Float32Array) => Promise<Record<string, unknown>>;
  model: ((inputs: Record<string, unknown>) => Promise<{ last_hidden_state?: { data: Float32Array }; embeddings?: { data: Float32Array } }>) & {
    dispose?: () => Promise<void>;
  };
};
type InMessage =
  | { type: "load"; model: ModelName; language?: string; slowRtf?: number; localOnly?: boolean }
  | { type: "cache-status"; model: ModelName }
  | { type: "prefetch"; model: ModelName; requestId: number }
  | { type: "load-speaker"; localOnly?: boolean }
  | { type: "speaker-cache-status" }
  | { type: "prefetch-speaker"; requestId: number }
  | { type: "cancel-embeds" }
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
let phrasesSinceLoad = 0;
let switching = false;
/** Set when this load had to fall back to the lighter model: a sign the device is slow. */
let downgraded = false;
/** Sticky once an embedding took longer than SLOW_EMBED_MS: later ones use the shorter crop. */
let cropSlow = false;
let lastEmbedMs: number | null = null;
let busyIntervals: Array<[number, number]> = [];

// ---- Speaker embedding model (lazy, lowest priority, never blocks or fails ASR) ----
let speakerPromise: Promise<SpeakerModel | null> | null = null;
let speakerModel: SpeakerModel | null = null;

function loadSpeaker(localOnly: boolean): Promise<SpeakerModel | null> {
  if (speakerPromise) return speakerPromise;
  const p = (async () => {
    try {
      // Never compete with the ASR model for the download or the CPU.
      await loaded.get(active);
      const opts = { ...(localOnly ? { local_files_only: true } : {}) };
      const fe = (await AutoFeatureExtractor.from_pretrained(SPEAKER_MODEL.repo, opts)) as unknown as SpeakerModel["fe"];
      const model = (await AutoModel.from_pretrained(SPEAKER_MODEL.repo, {
        device: "wasm",
        dtype: SPEAKER_MODEL.dtype,
        ...opts,
      })) as unknown as SpeakerModel["model"];
      const sm: SpeakerModel = { fe, model };
      await embedWith(sm, new Float32Array(SAMPLE_RATE)); // warm-up on 1 s of silence
      speakerModel = sm;
      self.postMessage({ type: "speaker-ready", ok: true });
      return sm;
    } catch (err) {
      console.warn("[speaker] model unavailable:", err);
      speakerModel = null;
      speakerPromise = null;
      self.postMessage({ type: "speaker-ready", ok: false });
      return null;
    }
  })();
  speakerPromise = p;
  return p;
}

async function embedWith(sm: SpeakerModel, audio: Float32Array): Promise<Float32Array> {
  const inputs = await sm.fe(audio);
  const out = await sm.model(inputs);
  const data = (out.last_hidden_state ?? out.embeddings)?.data;
  if (!data) throw new Error("speaker model returned no embedding");
  const v = Float32Array.from(data);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

async function warmUp(t: Transcriber) {
  // The first inference allocates buffers and compiles kernels; doing it on a second of
  // silence now keeps the user's first real phrase from being the slow one.
  // If this fails the model can't run on this device at all: let the load fail with that error
  // instead of reporting "ready" and silently losing every phrase.
  await t(new Float32Array(SAMPLE_RATE), { max_new_tokens: 2 });
}

function loadModel(name: ModelName, reportProgress: boolean, localOnly = false): Promise<Transcriber> {
  const existing = loaded.get(name);
  if (existing) return existing;
  let lastPct = -1;
  const p = pipeline("automatic-speech-recognition", MODELS[name].repo, {
    device: "wasm",
    dtype: "q8",
    // Offline: never touch the network. A cached model loads; an uncached one fails fast.
    ...(localOnly ? { local_files_only: true } : {}),
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
  if (++phrasesSinceLoad <= WARMUP_PHRASES_IGNORED) return;
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
      downgraded = true;
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
    if (job.kind === "final" && job.embed) queueEmbed(job, seconds);
  } catch (err) {
    self.postMessage({ type: "error", id: job.id, message: String((err as Error)?.message ?? err) });
    if (job.kind === "final" && job.embed) skipEmbed(job.id, "error");
  }
}

function skipEmbed(id: number, skipped: EmbedSkip) {
  self.postMessage({ type: "embedding", id, skipped });
}

/** Decides whether a finished phrase gets an embedding. Crops now so the full buffer can be freed. */
function queueEmbed(job: Job, seconds: number) {
  const slow = switching || downgraded || busyFraction(busyIntervals, performance.now()) > BUSY_SLOW_FRACTION;
  const decision = embedDecision({ seconds, finalsWaiting: finals.length, speakerLoaded: !!speakerModel, slow });
  if (decision !== "embed") {
    skipEmbed(job.id, decision);
    return;
  }
  embeds.push({ id: job.id, audio: cropMiddle(job.audio, cropSecFor(lastEmbedMs, cropSlow)) });
  while (embeds.length > MAX_EMBED_QUEUE) {
    const dropped = embeds.shift()!;
    skipEmbed(dropped.id, "queue");
  }
}

async function runEmbed(job: EmbedJob) {
  const sm = speakerModel;
  if (!sm) {
    skipEmbed(job.id, "unavailable");
    return;
  }
  try {
    const t0 = performance.now();
    const vector = await embedWith(sm, job.audio);
    const embedMs = Math.round(performance.now() - t0);
    const cropSec = Math.round((job.audio.length / SAMPLE_RATE) * 10) / 10;
    lastEmbedMs = embedMs;
    if (embedMs > SLOW_EMBED_MS) cropSlow = true;
    console.info(`[speaker] embedMs=${embedMs} cropSec=${cropSec}`);
    self.postMessage({ type: "embedding", id: job.id, vector, embedMs, cropSec }, [vector.buffer]);
  } catch (err) {
    console.warn("[speaker] embedding failed:", err);
    skipEmbed(job.id, "error"); // silent for the user (D-13)
  }
}

// ---- Scheduling ------------------------------------------------------------------
const finals: Job[] = [];
let partial: Job | null = null;
const embeds: EmbedJob[] = [];
let running = false;

function pump() {
  if (running) return;
  let job: Job | EmbedJob | null = finals.shift() ?? partial;
  if (job && job === partial) partial = null;
  // Embeddings are the lowest priority: only when nothing else is waiting.
  if (!job && finals.length === 0 && !partial) job = embeds.shift() ?? null;
  if (!job) return;
  running = true;
  const start = performance.now();
  const work = "kind" in job ? run(job) : runEmbed(job);
  work.finally(() => {
    const end = performance.now();
    busyIntervals.push([start, end]);
    busyIntervals = busyIntervals.filter(([, e]) => end - e < BUSY_WINDOW_MS);
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
    phrasesSinceLoad = 0;
    downgraded = false;
    cropSlow = false;
    lastEmbedMs = null;
    busyIntervals = [];
    unloadOthers([active]);
    loadModel(active, true, !!msg.localOnly)
      .then(() => self.postMessage({ type: "ready", model: active, threads: onnx.wasm?.numThreads ?? 1 }))
      .catch((err) => self.postMessage({ type: "error", message: String(err?.message ?? err) }));
    return;
  }

  if (msg.type === "cache-status") {
    ModelRegistry.is_pipeline_cached_files("automatic-speech-recognition", MODELS[msg.model].repo, { device: "wasm", dtype: "q8" })
      .then((r) => self.postMessage({ type: "cache-status", model: msg.model, cached: !!r.allCached }))
      .catch(() => self.postMessage({ type: "cache-status", model: msg.model, cached: false }));
    return;
  }

  if (msg.type === "prefetch") {
    // Download only: same options as loadModel, but the model is not kept resident.
    const { requestId, model } = msg;
    let lastPct = -1;
    pipeline("automatic-speech-recognition", MODELS[model].repo, {
      device: "wasm",
      dtype: "q8",
      progress_callback: (info: ProgressInfo) => {
        if (info.status !== "progress_total") return;
        const pct = Math.round(info.progress);
        if (pct === lastPct) return;
        lastPct = pct;
        self.postMessage({ type: "prefetch-progress", requestId, progress: pct });
      },
    })
      .then(async (t) => {
        await (t as unknown as Transcriber).dispose?.();
        self.postMessage({ type: "prefetched", requestId, model });
      })
      .catch((err) => self.postMessage({ type: "error", requestId, message: String(err?.message ?? err) }));
    return;
  }

  if (msg.type === "load-speaker") {
    void loadSpeaker(!!msg.localOnly);
    return;
  }

  if (msg.type === "speaker-cache-status") {
    ModelRegistry.is_cached_files(SPEAKER_MODEL.repo, { device: "wasm", dtype: SPEAKER_MODEL.dtype, include_tokenizer: false } as Parameters<typeof ModelRegistry.is_cached_files>[1])
      .then((r) => self.postMessage({ type: "speaker-cache-status", cached: !!r.allCached }))
      .catch(() => self.postMessage({ type: "speaker-cache-status", cached: false }));
    return;
  }

  if (msg.type === "prefetch-speaker") {
    const { requestId } = msg;
    if (speakerModel) {
      self.postMessage({ type: "prefetched", requestId, model: "speaker" });
      return;
    }
    let lastPct = -1;
    const progress_callback = (info: ProgressInfo) => {
      if (info.status !== "progress_total") return;
      const pct = Math.round(info.progress);
      if (pct === lastPct) return;
      lastPct = pct;
      self.postMessage({ type: "prefetch-progress", requestId, progress: pct });
    };
    (async () => {
      await AutoFeatureExtractor.from_pretrained(SPEAKER_MODEL.repo, { progress_callback });
      const m = (await AutoModel.from_pretrained(SPEAKER_MODEL.repo, {
        device: "wasm",
        dtype: SPEAKER_MODEL.dtype,
        progress_callback,
      })) as unknown as SpeakerModel["model"];
      await m.dispose?.();
      self.postMessage({ type: "prefetched", requestId, model: "speaker" });
    })().catch((err) => self.postMessage({ type: "error", requestId, message: String(err?.message ?? err) }));
    return;
  }

  if (msg.type === "cancel-embeds") {
    for (const e of embeds.splice(0)) skipEmbed(e.id, "cancelled");
    return;
  }

  if (msg.type === "transcribe") {
    const job: Job = { id: msg.id, audio: msg.audio, kind: msg.kind, embed: msg.embed };
    if (job.kind === "final") {
      finals.push(job);
    } else {
      if (partial) self.postMessage({ type: "skipped", id: partial.id }); // superseded by newer audio
      partial = job;
    }
    pump();
  }
};
