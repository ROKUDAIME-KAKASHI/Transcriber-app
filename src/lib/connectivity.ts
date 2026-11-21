import { getNetwork, hasPlugin } from "@/lib/native";

const FRESH_MS = 10_000;
let cached: { at: number; ok: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

function invalidate() {
  cached = null;
}

/** True when the server answers /api/health. navigator.onLine alone lies on phones. */
export async function isReachable(opts?: { force?: boolean }): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (navigator.onLine === false) return false;
  if (!opts?.force && cached && Date.now() - cached.at < FRESH_MS) return cached.ok;
  if (inflight) return inflight;
  inflight = (async () => {
    let ok = false;
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
      ok = res.status === 204 || res.ok;
    } catch {
      ok = false;
    }
    cached = { at: Date.now(), ok };
    return ok;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function markUnreachable(): void {
  cached = { at: Date.now(), ok: false };
}

export function onConnectivityHint(cb: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  const onOnline = () => {
    invalidate();
    cb(true);
  };
  const onOffline = () => {
    invalidate();
    cb(false);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  let remove: (() => void) | null = null;
  if (hasPlugin("Network")) {
    getNetwork()
      .then((net) => net.addListener("networkStatusChange", (s: { connected: boolean }) => {
        invalidate();
        cb(s.connected);
      }))
      .then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {});
  }

  return () => {
    cancelled = true;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    remove?.();
  };
}
