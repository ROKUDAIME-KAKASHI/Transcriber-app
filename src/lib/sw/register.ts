import { canApplyUpdate } from "@/lib/sw/updateCore";

const RELOAD_GUARD = "sw.reloading";

function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

async function cleanupDev(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("tr-") || k === "transcriber-shell-v1").map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

/** Registers the SW in production; in dev removes registrations and tr-* caches. Never throws. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  if (process.env.NODE_ENV !== "production") {
    await cleanupDev();
    return null;
  }
  try {
    if (document.readyState !== "complete") {
      await new Promise<void>((res) => window.addEventListener("load", () => res(), { once: true }));
    }
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (err) {
    console.warn("Service worker registration failed; offline support is unavailable.", err);
    return null;
  }
}

export function watchForUpdate(reg: ServiceWorkerRegistration, onWaiting: () => void): void {
  const hasController = () => !!navigator.serviceWorker.controller;
  const check = () => {
    if (canApplyUpdate({ recording: false, hasWaiting: !!reg.waiting, hasController: hasController() })) onWaiting();
  };
  check();
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed") check();
    });
  });
}

let controllerListenerAdded = false;

export function applyUpdate(reg: ServiceWorkerRegistration): void {
  if (!reg.waiting) return;
  try {
    // Timestamp guard: a reload destroys any timer, so compare ages instead of clearing the key.
    const prev = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
    if (prev && Date.now() - prev < 10_000) return;
    sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
  } catch {
    /* ignore */
  }
  if (!controllerListenerAdded) {
    controllerListenerAdded = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  }
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
}

export function warmLazy(): void {
  if (!supported()) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  if (conn?.saveData || conn?.type === "cellular") return;
  navigator.serviceWorker.controller?.postMessage({ type: "WARM_LAZY" });
}

export function checkForUpdate(reg: ServiceWorkerRegistration): void {
  reg.update().catch(() => {});
}

/**
 * Removes cached copies of Turbopack worker entry scripts that were stored without their query.
 * An offline-cache version before fab418b served such a copy for "…/turbopack-worker-*.js?params=…",
 * and the worker then died with "Missing worker bootstrap config". Phones can keep running that old
 * service worker for a while, so the page cleans the entry itself: on a miss the old worker fetches
 * the script from the network (keeping its query) and the speech engine starts. Never throws.
 */
export async function purgeStaleWorkerScripts(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  let removed = 0;
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const url = new URL(req.url);
        if (url.pathname.includes("/turbopack-worker") && !url.search) {
          if (await cache.delete(req)) removed++;
        }
      }
    }
  } catch {
    /* ignore: best effort */
  }
  return removed;
}
