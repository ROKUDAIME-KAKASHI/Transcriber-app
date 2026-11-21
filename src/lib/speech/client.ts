"use client";

/**
 * Main-thread handle to the speech worker. One worker per tab, kept alive between recordings
 * so the model only loads once (and is cached by the browser after the first download).
 */
import { MODELS, type Engine, type ModelName } from "./models";
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
  | { type: "prefetched"; requestId: number; model: ModelName }
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
    else if (msg.type === "cache-status") {
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
    worker?.terminate();
    worker = null;
    ready = null;
    readyFor = "";
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
  return ready;
}

function send(audio: Float32Array, kind: "final" | "partial"): Promise<string | null> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: "transcribe", id, audio, kind }, [audio.buffer]);
  });
}

/** Transcribes a finished phrase (16 kHz mono). Finished phrases resolve in the order sent. */
export async function transcribeSegment(audio: Float32Array): Promise<string> {
  return (await send(audio, "final")) ?? "";
}

/**
 * Live preview of the phrase still being spoken. Lower priority than finished phrases;
 * resolves to null if a newer preview replaced it before it ran.
 */
export function transcribePartial(audio: Float32Array): Promise<string | null> {
  return send(audio, "partial");
}

/** True while the worker is in use for a recording (a recording is running or phrases are queued). */
export function isWorkerBusy(): boolean {
  return pending.size > 0 || isWebRecordingNow();
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
  worker.terminate();
  worker = null;
  ready = null;
  readyFor = "";
}
