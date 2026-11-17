"use client";

/**
 * Main-thread handle to the Moonshine worker. One worker per tab, kept alive
 * between recordings so the model only loads once (and is cached by the browser
 * after the first download).
 */
export type MoonshineModel = "base" | "tiny";

type WorkerOut =
  | { type: "progress"; progress: number }
  | { type: "ready"; model: MoonshineModel; threads: number }
  | { type: "result"; id: number; text: string; rtf: number }
  | { type: "skipped"; id: number }
  | { type: "model"; model: MoonshineModel }
  | { type: "error"; id?: number; message: string };

const MODEL_KEY = "transcriber.moonshineModel";

let worker: Worker | null = null;
let ready: Promise<{ model: MoonshineModel; threads: number }> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: string | null) => void; reject: (e: Error) => void }>();
let progressListener: ((pct: number) => void) | null = null;
let modelListener: ((m: MoonshineModel) => void) | null = null;

function readPreferredModel(): MoonshineModel {
  try {
    if (localStorage.getItem(MODEL_KEY) === "tiny") return "tiny";
  } catch {
    /* storage blocked */
  }
  // Phones that report ≤2 GB of RAM (Chrome/Android only) start on Tiny straight away.
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem !== undefined && mem <= 2 ? "tiny" : "base";
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/moonshine.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data;
    if (msg.type === "progress") progressListener?.(msg.progress);
    else if (msg.type === "model") {
      // The device was too slow for Base: remember, so next time it starts on Tiny.
      try { localStorage.setItem(MODEL_KEY, msg.model); } catch { /* ignore */ }
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
 * Downloads (first time: ~63 MB Base or ~28 MB Tiny) and initialises the model.
 * Safe to call repeatedly. `slowRtf` is only for testing the slow-device switch.
 */
export function loadMoonshine(
  onProgress?: (pct: number) => void,
  opts: { onModelChange?: (m: MoonshineModel) => void; slowRtf?: number } = {}
): Promise<{ model: MoonshineModel; threads: number }> {
  progressListener = onProgress ?? null;
  modelListener = opts.onModelChange ?? null;
  if (ready) return ready;
  const w = getWorker();
  ready = new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === "ready") {
        w.removeEventListener("message", onMsg);
        resolve({ model: e.data.model, threads: e.data.threads });
      } else if (e.data.type === "error" && e.data.id === undefined) {
        w.removeEventListener("message", onMsg);
        ready = null;
        reject(new Error(e.data.message));
      }
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ type: "load", model: readPreferredModel(), slowRtf: opts.slowRtf });
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
