import { useSyncExternalStore } from "react";
import { getApp, getNetwork, hasPlugin } from "@/lib/native";
import { INITIAL_CONN, reduce, type ConnEvent, type ConnState, type ConnStatus } from "@/lib/connectivityCore";

const FRESH_MS = 10_000;
const RETRY_MS = 1500;
const POLL_ONLINE_MS = 30_000;
const POLL_OFFLINE_MS = 10_000;

let cached: { at: number; ok: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

// ---- store ----
let state: ConnState = INITIAL_CONN;
const listeners = new Set<() => void>();
let teardown: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function dispatch(event: ConnEvent) {
  const { state: next, effect } = reduce(state, event);
  const changed = next.status !== state.status;
  state = next;
  if (changed) emit();
  if (effect === "probe-now") void probe(true);
  else if (effect === "retry-probe") setTimeout(() => void probe(true), RETRY_MS);
}

function invalidate() {
  cached = null;
}

async function rawProbe(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

/** Shared probe: feeds both the legacy cache and the store. */
function probe(force: boolean): Promise<boolean> {
  if (inflight) return inflight;
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.ok);
  inflight = (async () => {
    const ok = await rawProbe();
    cached = { at: Date.now(), ok };
    dispatch(ok ? { type: "probe-ok" } : { type: "probe-fail", navigatorOnLine: navigator.onLine !== false });
    return ok;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** True when the server answers /api/health. navigator.onLine alone lies on phones. */
export async function isReachable(opts?: { force?: boolean }): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (navigator.onLine === false) return false;
  return probe(!!opts?.force);
}

export function markUnreachable(): void {
  cached = { at: Date.now(), ok: false };
  if (typeof window === "undefined") return;
  dispatch({ type: "probe-fail", navigatorOnLine: navigator.onLine !== false });
  void probe(true);
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

// ---- monitoring (starts on first subscriber, stops on last) ----
function schedule() {
  if (timer) clearTimeout(timer);
  const ms = state.status === "online" ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
  timer = setTimeout(async () => {
    if (document.visibilityState === "visible") await probe(true);
    if (teardown) schedule();
  }, ms);
}

function startMonitoring() {
  if (typeof window === "undefined") return;
  const onOnline = () => dispatch({ type: "hint-online" });
  const onOffline = () => dispatch({ type: "hint-offline" });
  const onVisible = () => {
    if (document.visibilityState === "visible") void probe(true);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);

  let cancelled = false;
  const removers: Array<() => void> = [];
  if (hasPlugin("Network")) {
    getNetwork()
      .then((net) => net.addListener("networkStatusChange", (s: { connected: boolean }) => {
        dispatch(s.connected ? { type: "hint-online" } : { type: "plugin-disconnected" });
      }))
      .then((h) => {
        if (cancelled) void h.remove();
        else removers.push(() => void h.remove());
      })
      .catch(() => {});
  }
  if (hasPlugin("App")) {
    getApp()
      .then((app) => app.addListener("appStateChange", (s: { isActive: boolean }) => {
        if (s.isActive) void probe(true);
      }))
      .then((h) => {
        if (cancelled) void h.remove();
        else removers.push(() => void h.remove());
      })
      .catch(() => {});
  }

  teardown = () => {
    cancelled = true;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    removers.forEach((r) => r());
    if (timer) clearTimeout(timer);
    timer = null;
  };
  if (navigator.onLine === false) dispatch({ type: "hint-offline" });
  void probe(true);
  schedule();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) startMonitoring();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      teardown?.();
      teardown = null;
    }
  };
}

export function getSnapshot(): ConnStatus {
  return state.status;
}

export function getServerSnapshot(): ConnStatus {
  return "unknown";
}

export function getConnectivity(): ConnStatus {
  return state.status;
}

export function useConnectivity(): ConnStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
