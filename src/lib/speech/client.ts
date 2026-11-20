"use client";

/**
 * Main-thread handle to the speech worker. One worker per tab, kept alive between recordings
 * so the model only loads once (and is cached by the browser after the first download).
 */
import { MODELS, type Engine, type ModelName } from "./models";

type WorkerOut =
  | { type: "progress"; progress: number }
  | { type: "ready"; model: ModelName; threads: number }
  | { type: "result"; id: number; text: string; rtf: number }
  | { type: "skipped"; id: number }
  | { type: "model"; model: ModelName }
  | { type: "error"; id?: number; message: string };

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
    else if (msg.type === "model") {
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
    w.postMessage({ type: "load", model: preferredModel(engine), language, slowRtf: opts.slowRtf });
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
