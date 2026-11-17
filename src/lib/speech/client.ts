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

/** Remembers when a device turned out too slow for an engine's bigger model. */
const downgradeKey = (engine: Engine) => `transcriber.model.${engine}`;
const LEGACY_MOONSHINE_KEY = "transcriber.moonshineModel";

let worker: Worker | null = null;
let ready: Promise<{ model: ModelName; threads: number }> | null = null;
let readyFor = ""; // "engine:language" the current `ready` was loaded for
let nextId = 1;
const pending = new Map<number, { resolve: (t: string | null) => void; reject: (e: Error) => void }>();
let progressListener: ((pct: number) => void) | null = null;
let modelListener: ((m: ModelName) => void) | null = null;

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
  if (readStored(downgradeKey("moonshine")) === "moonshine-tiny" || readStored(LEGACY_MOONSHINE_KEY) === "tiny") {
    return "moonshine-tiny";
  }
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
      try { localStorage.setItem(downgradeKey(MODELS[msg.model].family), msg.model); } catch { /* ignore */ }
      modelListener?.(msg.model);
    } else if (msg.type === "result" || msg.type === "skipped") {
      pending.get(msg.id)?.resolve(msg.type === "result" ? msg.text : null);
      pending.delete(msg.id);
    } else if (msg.type === "error" && msg.id !== undefined) {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    }
  };
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
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === "ready") {
        w.removeEventListener("message", onMsg);
        resolve({ model: e.data.model, threads: e.data.threads });
      } else if (e.data.type === "error" && e.data.id === undefined) {
        w.removeEventListener("message", onMsg);
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
