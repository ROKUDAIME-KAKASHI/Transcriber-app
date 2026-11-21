/**
 * Offline readiness for the on-device engines (D-19..D-21). The pure helpers at the top are
 * covered by node tests (so imports are relative with .ts extensions and nothing touches the DOM);
 * the runtime wrappers below load the client lazily and are only called in the browser.
 */
import { MODELS, type Engine, type ModelName } from "./models.ts";

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

export function totalSizeMb(chain: ModelName[]): number {
  return chain.reduce((sum, m) => sum + MODELS[m].downloadMb, 0);
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

const ORT_URL = "/ort/ort-wasm-simd-threaded.wasm";

export async function ortCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const hit = await caches.match(new URL(ORT_URL, self.location.origin).href);
    return !!hit;
  } catch {
    return false;
  }
}

export type EngineReadiness = { status: ReadinessStatus; chain: ModelName[]; chainCached: boolean[]; ortCached: boolean };

export async function engineStatus(engine: Engine): Promise<EngineReadiness> {
  const client = await import("./client");
  const chain = chainFor(engine, client.preferredModel(engine));
  const chainCached = await Promise.all(chain.map((m) => client.cacheStatus(m)));
  const ort = await ortCached();
  return { status: statusFrom({ chainCached, ortCached: ort }), chain, chainCached, ortCached: ort };
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
    for (let i = 0; i < chain.length; i++) {
      if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
      if (await client.cacheStatus(chain[i])) {
        onProgress(Math.round(((i + 1) / chain.length) * 100));
        continue;
      }
      await client.prefetchModel(chain[i], (pct) => onProgress(Math.round(((i + pct / 100) / chain.length) * 100)));
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
