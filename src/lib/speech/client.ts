"use client";

/**
 * Main-thread handle to the speech worker. One worker per tab, kept alive between recordings
 * so the model only loads once (and is cached by the browser after the first download).
 */
import { MODELS, type Engine, type ModelName } from "./models";
import type { EmbedSkip } from "./embedSchedule";
import { getConnectivity } from "@/lib/connectivity";
import { isWebRecordingNow } from "@/lib/recordingFlag";

type WorkerOut =
  | { type: "progress"; progress: number }
  | { type: "ready"; model: ModelName; threads: number }
  | { type: "result"; id: number; text: string; rtf: number }
  | { type: "skipped"; id: number }
  | { type: "model"; model: ModelName }
  | { type: "cache-status"; model: ModelName; cached: boolean }
  | { type: "prefetch-progress"; requestId: number; progress: number }
  | { type: "prefetched"; requestId: number; model: ModelName | "speaker" }
  | { type: "speaker-ready"; ok: boolean }
  | { type: "speaker-cache-status"; cached: boolean }
  | { type: "embedding"; id: number; vector?: Float32Array; skipped?: EmbedSkip; embedMs?: number; cropSec?: number }
  | { type: "error"; id?: number; requestId?: number; message: string };

/**
 * Remembers when a device turned out too slow for an engine's bigger model. Stored as
 * "model@timestamp" and forgotten after DOWNGRADE_TTL_MS: one slow first run (cold phone, thermal
 * throttling) used to lock a phone onto the less accurate Tiny model forever.
 */
const downgradeKey = (engine: Engine) => `transcriber.model.${engine}`;
const LEGACY_MOONSHINE_KEY = "transcriber.moonshineModel";
const DOWNGRADE_TTL_MS = 3 * 24 * 3600 * 1000;

let worker: Worker | null = null;
let ready: Promise<{ model: ModelName; threads: number }> | null = null;
let readyFor = ""; // "engine:language" the current `ready` was loaded for
let nextId = 1;
const pending = new Map<number, { resolve: (t: string | null) => void; reject: (e: Error) => void }>();
let progressListener: ((pct: number) => void) | null = null;
let modelListener: ((m: ModelName) => void) | null = null;
/** Rejecters for a model load in progress, called if the worker dies. */
const failListeners = new Set<(e: Error) => void>();
/** Offline-readiness plumbing: kept apart from the load/transcribe listeners above. */
const cacheWaiters = new Map<ModelName, ((cached: boolean) => void)[]>();
const prefetches = new Map<number, { resolve: () => void; reject: (e: Error) => void; onProgress: (pct: number) => void }>();
let nextRequestId = 1;
/** Speaker embeddings (on-device diarization): ids sent with embed:true whose "embedding" message hasn't arrived. */
export type EmbeddingEvent = { id: number; vector?: Float32Array; skipped?: EmbedSkip; embedMs?: number; cropSec?: number };
const outstandingEmbeds = new Set<number>();
const embedListeners = new Set<(e: EmbeddingEvent) => void>();
let speakerLoad: Promise<boolean> | null = null;
let speakerResolve: ((ok: boolean) => void) | null = null;
let speakerIsReady = false;
let speakerCacheWaiters: ((cached: boolean) => void)[] = [];
const embedDrainWaiters = new Set<() => void>();

function emitEmbedding(e: EmbeddingEvent) {
  outstandingEmbeds.delete(e.id);
  embedListeners.forEach((f) => f(e));
  if (outstandingEmbeds.size === 0) {
    embedDrainWaiters.forEach((f) => f());
    embedDrainWaiters.clear();
  }
}

/** The worker died or was stopped: every phrase still waiting for an embedding is skipped. */
function resetSpeakerState() {
  const ids = [...outstandingEmbeds];
  outstandingEmbeds.clear();
  ids.forEach((id) => embedListeners.forEach((f) => f({ id, skipped: "error" })));
  embedDrainWaiters.forEach((f) => f());
  embedDrainWaiters.clear();
  speakerResolve?.(false);
  speakerResolve = null;
  speakerLoad = null;
  speakerIsReady = false;
  speakerCacheWaiters.forEach((f) => f(false));
  speakerCacheWaiters = [];
}
/** True while a model load (worker "load") is in flight; the worker must not be terminated then. */
let loadingModel = false;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
}

/** Picks the bigger, more accurate model unless this device is known (or likely) to be too slow for it. */
export function preferredModel(engine: Engine): ModelName {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  // Whisper Base (~77 MB). Whisper Small was tested and dropped: on an 8-core laptop it needed
  // ~1.2× real time per phrase (CPU/WASM), so it falls behind in a live meeting.
  if (engine === "whisper") return "whisper-base";
  try {
    localStorage.removeItem(LEGACY_MOONSHINE_KEY); // old permanent flag
  } catch {
    /* ignore */
  }
  const [stored, at] = (readStored(downgradeKey("moonshine")) ?? "").split("@");
  if (stored === "moonshine-tiny" && Date.now() - Number(at || 0) < DOWNGRADE_TTL_MS) return "moonshine-tiny";
  // Phones that report ≤2 GB of RAM (Chrome/Android only) start on Tiny straight away.
  return mem !== undefined && mem <= 2 ? "moonshine-tiny" : "moonshine-base";
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/speech.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data;
    if (msg.type === "progress") progressListener?.(msg.progress);
    else if (msg.type === "embedding") emitEmbedding(msg);
    else if (msg.type === "speaker-ready") {
      speakerIsReady = msg.ok;
      if (!msg.ok) speakerLoad = null; // allow a retry later
      speakerResolve?.(msg.ok);
      speakerResolve = null;
    } else if (msg.type === "speaker-cache-status") {
      speakerCacheWaiters.forEach((f) => f(msg.cached));
      speakerCacheWaiters = [];
    } else if (msg.type === "cache-status") {
      cacheWaiters.get(msg.model)?.forEach((f) => f(msg.cached));
      cacheWaiters.delete(msg.model);
    } else if (msg.type === "prefetch-progress") prefetches.get(msg.requestId)?.onProgress(msg.progress);
    else if (msg.type === "prefetched") {
      prefetches.get(msg.requestId)?.resolve();
      prefetches.delete(msg.requestId);
    } else if (msg.type === "error" && msg.requestId !== undefined) {
      prefetches.get(msg.requestId)?.reject(new Error(msg.message));
      prefetches.delete(msg.requestId);
    } else if (msg.type === "model") {
      // The device was too slow for the bigger model: remember, so next time it starts on the lighter one.
      try { localStorage.setItem(downgradeKey(MODELS[msg.model].family), `${msg.model}@${Date.now()}`); } catch { /* ignore */ }
      modelListener?.(msg.model);
    } else if (msg.type === "result" || msg.type === "skipped") {
      pending.get(msg.id)?.resolve(msg.type === "result" ? msg.text : null);
      pending.delete(msg.id);
    } else if (msg.type === "error" && msg.id !== undefined) {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    }
  };
  // The worker itself failed (script/WASM didn't load, or the phone killed it for memory).
  // Without this, "Loading speech model…" and every pending phrase waited forever.
  const fail = (message: string) => {
    const err = new Error(message);
    failListeners.forEach((f) => f(err));
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    for (const p of prefetches.values()) p.reject(err);
    prefetches.clear();
    cacheWaiters.forEach((l) => l.forEach((f) => f(false)));
    cacheWaiters.clear();
    resetSpeakerState();
    worker?.terminate();
    worker = null;
    ready = null;
    readyFor = "";
    loadingModel = false;
  };
  worker.onerror = (e) => {
    e.preventDefault();
    fail(`The speech engine stopped${e.message ? ` (${e.message})` : ""}. This phone may be low on memory — try the Fast or Cloud engine.`);
  };
  worker.onmessageerror = () => fail("The speech engine couldn't read the audio.");
  return worker;
}

/**
 * Downloads (first time only) and initialises the model for `engine`.
 * Safe to call repeatedly; switching engine or language reloads. `slowRtf` is for testing the slow-device switch.
 */
export function loadSpeechModel(
  engine: Engine,
  language: string,
  onProgress?: (pct: number) => void,
  opts: { onModelChange?: (m: ModelName) => void; slowRtf?: number } = {}
): Promise<{ model: ModelName; threads: number }> {
  progressListener = onProgress ?? null;
  modelListener = opts.onModelChange ?? null;
  const key = `${engine}:${language}`;
  if (ready && readyFor === key) return ready;
  const w = getWorker();
  readyFor = key;
  loadingModel = true;
  ready = new Promise((resolve, reject) => {
    const onFail = (err: Error) => {
      failListeners.delete(onFail);
      reject(err);
    };
    failListeners.add(onFail);
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === "ready") {
        w.removeEventListener("message", onMsg);
        failListeners.delete(onFail);
        resolve({ model: e.data.model, threads: e.data.threads });
      } else if (e.data.type === "error" && e.data.id === undefined) {
        w.removeEventListener("message", onMsg);
        failListeners.delete(onFail);
        ready = null;
        readyFor = "";
        reject(new Error(e.data.message));
      }
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ type: "load", model: preferredModel(engine), language, slowRtf: opts.slowRtf, localOnly: getConnectivity() === "offline" });
  });
  const settled = () => {
    loadingModel = false;
  };
  ready.then(settled, settled);
  return ready;
}

function send(audio: Float32Array, kind: "final" | "partial", embed = false, batch = false): { id: number; result: Promise<string | null> } {
  const id = nextId++;
  const result = new Promise<string | null>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    if (embed) outstandingEmbeds.add(id);
    // One transfer: the worker crops the speaker-embedding audio from this same buffer.
    getWorker().postMessage({ type: "transcribe", id, audio, kind, embed, batch }, [audio.buffer]);
  });
  return { id, result };
}

/**
 * Like transcribeSegment, but exposes the phrase id so the caller can match the later
 * "embedding" event (see onEmbedding) when opts.embed is true.
 */
export function transcribeFinal(audio: Float32Array, opts: { embed?: boolean; batch?: boolean } = {}): { id: number; text: Promise<string> } {
  const { id, result } = send(audio, "final", !!opts.embed, !!opts.batch);
  return { id, text: result.then((t) => t ?? "") };
}

/** Transcribes a finished phrase (16 kHz mono). Finished phrases resolve in the order sent. */
export async function transcribeSegment(audio: Float32Array, opts: { embed?: boolean } = {}): Promise<string> {
  return transcribeFinal(audio, opts).text;
}

/**
 * Live preview of the phrase still being spoken. Lower priority than finished phrases;
 * resolves to null if a newer preview replaced it before it ran.
 */
export function transcribePartial(audio: Float32Array): Promise<string | null> {
  return send(audio, "partial").result;
}

/** Subscribes to speaker-embedding results (a vector, or a skip reason). Returns the unsubscribe function. */
export function onEmbedding(fn: (e: EmbeddingEvent) => void): () => void {
  embedListeners.add(fn);
  return () => {
    embedListeners.delete(fn);
  };
}

/**
 * Loads the speaker model in the worker (after the speech model is ready). Never rejects:
 * resolves false if it isn't available (offline and not downloaded, worker died, ...).
 */
export function loadSpeakerModel(): Promise<boolean> {
  if (speakerLoad) return speakerLoad;
  try {
    const w = getWorker();
    speakerLoad = new Promise<boolean>((resolve) => {
      speakerResolve = resolve;
      w.postMessage({ type: "load-speaker", localOnly: getConnectivity() === "offline" });
    });
    return speakerLoad;
  } catch {
    speakerLoad = null;
    return Promise.resolve(false);
  }
}

export function speakerReady(): boolean {
  return speakerIsReady;
}

/** Phrases sent for embedding whose result hasn't come back yet. */
export function pendingEmbeds(): number {
  return outstandingEmbeds.size;
}

/** Waits until every outstanding embedding is back; after timeoutMs the rest are cancelled (skipped "cancelled"). */
export function drainEmbeddings(timeoutMs: number): Promise<void> {
  if (outstandingEmbeds.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (timer) clearTimeout(timer);
      embedDrainWaiters.delete(done);
      resolve();
    };
    embedDrainWaiters.add(done);
    timer = setTimeout(() => {
      try {
        worker?.postMessage({ type: "cancel-embeds" });
      } catch {
        /* worker gone */
      }
      done();
    }, timeoutMs);
  });
}

/** Whether the speaker model is fully in Cache Storage. Never throws; false on any problem. */
export function speakerCacheStatus(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      speakerCacheWaiters.push(resolve);
      getWorker().postMessage({ type: "speaker-cache-status" });
    } catch {
      resolve(false);
    }
  });
}

/** Downloads the speaker model into Cache Storage without keeping it loaded. Refuses while the worker is busy. */
export function prefetchSpeakerModel(onProgress: (pct: number) => void): Promise<void> {
  if (isWorkerBusy()) return Promise.reject(new Error("The speech engine is busy. Try again after the recording."));
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    prefetches.set(requestId, { resolve, reject, onProgress });
    getWorker().postMessage({ type: "prefetch-speaker", requestId });
  });
}

/** True while the worker is in use: a recording is running, phrases are queued, or a model is loading. */
export function isWorkerBusy(): boolean {
  return pending.size > 0 || outstandingEmbeds.size > 0 || loadingModel || isWebRecordingNow();
}

/** Asks the worker whether a model is fully in Cache Storage. Never throws; false on any problem. */
export function cacheStatus(model: ModelName): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const list = cacheWaiters.get(model) ?? [];
      list.push(resolve);
      cacheWaiters.set(model, list);
      getWorker().postMessage({ type: "cache-status", model });
    } catch {
      resolve(false);
    }
  });
}

/** Downloads a model into Cache Storage without loading it. Refuses while a recording uses the worker. */
export function prefetchModel(model: ModelName, onProgress: (pct: number) => void): Promise<void> {
  if (isWorkerBusy()) return Promise.reject(new Error("The speech engine is busy. Try again after the recording."));
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    prefetches.set(requestId, { resolve, reject, onProgress });
    getWorker().postMessage({ type: "prefetch", model, requestId });
  });
}

/** Stops a download by ending the worker (pipeline() has no abort). Saved files stay saved. */
export function cancelPrefetch(): void {
  if (isWorkerBusy() || !worker) return;
  const err = new Error("Download cancelled");
  for (const p of prefetches.values()) p.reject(err);
  prefetches.clear();
  cacheWaiters.forEach((l) => l.forEach((f) => f(false)));
  cacheWaiters.clear();
  resetSpeakerState();
  worker.terminate();
  worker = null;
  ready = null;
  readyFor = "";
}
