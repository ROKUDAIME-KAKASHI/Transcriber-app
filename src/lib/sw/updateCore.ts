export const RELOAD_WINDOW_MS = 60_000;

const CHUNK_RE = /Failed to load chunk|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "string") return CHUNK_RE.test(err);
  if (typeof err === "object") {
    const e = err as { name?: unknown; message?: unknown };
    if (e.name === "ChunkLoadError") return true;
    if (typeof e.message === "string") return CHUNK_RE.test(e.message);
  }
  return false;
}

export type ChunkAction = { action: "notice" } | { action: "reload" } | { action: "none" };

export function shouldReloadForChunkError(a: { recording: boolean; lastReloadAt: number | null; now: number }): ChunkAction {
  if (a.recording) return { action: "notice" };
  if (a.lastReloadAt === null || a.now - a.lastReloadAt >= RELOAD_WINDOW_MS) return { action: "reload" };
  return { action: "none" };
}

export function canApplyUpdate(a: { recording: boolean; hasWaiting: boolean; hasController: boolean }): boolean {
  return a.hasWaiting && a.hasController && !a.recording;
}
