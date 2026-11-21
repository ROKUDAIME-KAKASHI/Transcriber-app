/**
 * Offline readiness for the on-device engines (D-19..D-21). The pure helpers at the top are
 * covered by node tests (so imports are relative with .ts extensions and nothing touches the DOM);
 * the runtime wrappers below load the client lazily and are only called in the browser.
 */
import { MODELS, SPEAKER_MODEL, type Engine, type ModelName } from "./models.ts";

export type ReadinessStatus = "none" | "partial" | "ready" | "downloading" | "error";
export type Conn = "online" | "offline" | "unknown";

/** Models to download for an engine, preferred first, then its fallback, without duplicates. */
export function chainFor(engine: Engine, preferred: ModelName): ModelName[] {
  const out: ModelName[] = [];
  let cur: ModelName | null = preferred;
  while (cur && !out.includes(cur)) {
    if (MODELS[cur].family !== engine) break;
    out.push(cur);
    cur = MODELS[cur].fallback as ModelName | null;
  }
  return out;
}

/** Download size of a chain; includes the ~7 MB speaker model unless `opts.speaker === false`. */
export function totalSizeMb(chain: ModelName[], opts: { speaker?: boolean } = {}): number {
  const asr = chain.reduce((sum, m) => sum + MODELS[m].downloadMb, 0);
  return opts.speaker === false ? asr : asr + SPEAKER_MODEL.downloadMb;
}

/** ASR is ready but the speaker model is not saved: offer a speaker-only download (never blocks recording). */
export function needsSpeakerDownload(a: { status: ReadinessStatus; speakerCached: boolean }): boolean {
  return a.status === "ready" && !a.speakerCached;
}

/** "about 100 MB": rounded up to the next 5 MB so the label never understates the download. */
export function labelSize(mb: number): string {
  return `about ${Math.ceil(mb / 5) * 5} MB`;
}

export function statusFrom(a: { chainCached: boolean[]; ortCached: boolean; downloading?: boolean; error?: boolean }): ReadinessStatus {
  if (a.downloading) return "downloading";
  if (a.error) return "error";
  const n = a.chainCached.filter(Boolean).length;
  if (n === 0) return "none";
  if (n === a.chainCached.length && a.ortCached) return "ready";
  return "partial";
}

export const NOT_READY_OFFLINE = "Not ready offline. Download needs internet.";

/** Offline, recording on-device needs the preferred model and the ORT runtime already saved. */
export function startGate(a: { preferredCached: boolean; ortCached: boolean; conn: Conn }): { allowed: boolean; reason?: string } {
  if (a.conn !== "offline") return { allowed: true };
  if (a.preferredCached && a.ortCached) return { allowed: true };
  return { allowed: false, reason: NOT_READY_OFFLINE };
}

// ---- Runtime (browser only) -------------------------------------------------------------

const ORT_URLS = ["/ort/ort-wasm-simd-threaded.mjs", "/ort/ort-wasm-simd-threaded.wasm"];

export async function ortCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    // Both the loader and the wasm must be saved, otherwise the runtime cannot start offline.
    const hits = await Promise.all(ORT_URLS.map((u) => caches.match(new URL(u, self.location.origin).href)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

export type EngineReadiness = { status: ReadinessStatus; chain: ModelName[]; chainCached: boolean[]; ortCached: boolean; speakerCached: boolean };

export async function engineStatus(engine: Engine): Promise<EngineReadiness> {
  const client = await import("./client");
  const chain = chainFor(engine, client.preferredModel(engine));
  const chainCached = await Promise.all(chain.map((m) => client.cacheStatus(m)));
  const ort = await ortCached();
  const speakerCached = await client.speakerCacheStatus().catch(() => false);
  return { status: statusFrom({ chainCached, ortCached: ort }), chain, chainCached, ortCached: ort, speakerCached };
}

/**
 * Downloads every model in the engine's chain that is not saved yet. Rejects with an AbortError
 * when `signal` fires (the worker is terminated; finished files stay saved, so a retry resumes).
 */
export async function prefetchEngine(engine: Engine, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  const client = await import("./client");
  const chain = chainFor(engine, client.preferredModel(engine));
  const abort = () => client.cancelPrefetch();
  signal?.addEventListener("abort", abort);
  try {
    const sizes = [...chain.map((m) => MODELS[m].downloadMb), SPEAKER_MODEL.downloadMb];
    const total = sizes.reduce((a, b) => a + b, 0);
    let done = 0;
    const report = (partial: number) => onProgress(Math.min(100, Math.round(((done + partial) / total) * 100)));
    for (let i = 0; i < chain.length; i++) {
      if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
      if (!(await client.cacheStatus(chain[i]))) {
        await client.prefetchModel(chain[i], (pct) => report((pct / 100) * sizes[i]));
      }
      done += sizes[i];
      report(0);
    }
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
    if (!(await client.speakerCacheStatus())) {
      const last = sizes[sizes.length - 1];
      await client.prefetchSpeakerModel((pct) => report((pct / 100) * last));
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
    throw err;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  onProgress(100);
  const { requestPersist } = await import("@/lib/local/repo");
  await requestPersist().catch(() => {});
  if (!(await ortCached())) {
    const { warmLazy } = await import("@/lib/sw/register");
    warmLazy();
  }
}
