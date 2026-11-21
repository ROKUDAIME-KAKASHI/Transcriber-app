import { getApp, hasPlugin } from "@/lib/native";
import { isReachable, markUnreachable, onConnectivityHint } from "@/lib/connectivity";
import { parseTranscript } from "@/lib/transcript";
import * as repo from "./repo";
import { MAX_BATCH_PARTS, backoffDelay, classifyResponse, nextTailBatch, type ResponseClass } from "./syncCore";
import type { LocalMeeting } from "./types";

// Singleton sync engine. Touches IndexedDB only through repo (D-01).

export type SyncState = "idle" | "syncing" | "offline" | "needs-auth";
export interface SyncSnapshot {
  state: SyncState;
  userId: string | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}
export type FlushResult = "synced" | "pending" | "needs-auth" | "conflict";

export const PAGE_LOADED_AT = Date.now();

const PULL_EVERY_MS = 25_000;

let snapshot: SyncSnapshot = { state: "idle", userId: null, lastSyncedAt: null, lastError: null };
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<SyncSnapshot>) {
  const next = { ...snapshot, ...patch };
  if (
    next.state === snapshot.state &&
    next.userId === snapshot.userId &&
    next.lastSyncedAt === snapshot.lastSyncedAt &&
    next.lastError === snapshot.lastError
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}
export function subscribeSync(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const activeRecordings = new Set<string>();
export function markRecording(id: string, active: boolean): void {
  if (active) activeRecordings.add(id);
  else activeRecordings.delete(id);
}
export function isRecordingId(id: string): boolean {
  return activeRecordings.has(id);
}

// ---- engine state ----
let userId: string | null = null;
let running = false;
let rerun = false;
let forcePending = false;
let currentPass: Promise<void> | null = null;
let attempt = 0;
let nextAttemptAt = 0;
let lastPullMs = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let teardown: Array<() => void> = [];

interface Reply {
  status: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

async function req(method: string, url: string, body?: unknown): Promise<Reply> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: unknown = null;
    if (res.status !== 204) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    return { status: res.status, data };
  } catch {
    return { status: null, data: null };
  }
}

function okReset() {
  attempt = 0;
  nextAttemptAt = 0;
  if (snapshot.state === "needs-auth") setSnapshot({ state: "syncing", lastError: null });
}

type Step = "next" | "stop";

/** Handles auth / retry / bad-request. Returns whether to stop the whole pass. */
async function fail(uid: string, id: string, cls: ResponseClass, r: Reply): Promise<Step> {
  if (cls === "auth") {
    setSnapshot({ state: "needs-auth", lastError: "Signed out. Sign in again to sync." });
    return "stop";
  }
  if (cls === "retry") {
    if (r.status === null) markUnreachable();
    attempt++;
    nextAttemptAt = Date.now() + backoffDelay(attempt);
    setSnapshot({
      state: r.status === null ? "offline" : "idle",
      lastError: r.status === null ? null : `Server error ${r.status}`,
    });
    return "stop";
  }
  await repo.applySyncResult(uid, id, { syncError: "rejected" });
  return "next";
}

async function syncMeeting(uid: string, m: LocalMeeting): Promise<Step> {
  const id = m.id;
  const url = `/api/meetings/${encodeURIComponent(id)}`;

  if (m.deleted === 1) {
    const r = await req("DELETE", url);
    const cls = classifyResponse(r.status);
    if (cls === "ok" || cls === "not-found") {
      okReset();
      await repo.purge(uid, id);
      return "next";
    }
    return fail(uid, id, cls, r);
  }

  if (m.dirty.create) {
    const r = await req("POST", "/api/meetings", {
      id,
      title: m.title,
      language: m.language,
      deviceName: m.deviceName ?? undefined,
      engine: m.engine ?? undefined,
      createdAt: m.createdAt,
    });
    const cls = classifyResponse(r.status);
    if (cls === "ok") {
      okReset();
      const server = typeof r.data?.savedParts === "number" ? r.data.savedParts : 0;
      await repo.applySyncResult(uid, id, { clear: ["create"], savedParts: Math.min(m.savedParts, server) });
    } else if (cls === "conflict") {
      await repo.applySyncResult(uid, id, { syncError: "conflict" });
      return "next";
    } else {
      return fail(uid, id, cls, r);
    }
  }

  // RecordingService owns native rows (D-18): no tail / finish from JS.
  if (m.origin === "native") return "next";

  let cur = (await repo.getMeta(uid, id)) ?? m;

  if (cur.dirty.tail) {
    const data = await repo.getParts(uid, id);
    if (!data) return "next";
    const readRev = data.localRev;
    let saved = cur.savedParts;
    let maxParts = MAX_BATCH_PARTS;
    let conflicts = 0;
    for (;;) {
      const batch = nextTailBatch(data.parts, saved, maxParts);
      const r = await req("PATCH", url, {
        transcriptTail: { from: batch.from, parts: batch.parts },
        durationSec: cur.durationSec,
      });
      const cls = classifyResponse(r.status);
      if (cls === "ok") {
        okReset();
        saved = typeof r.data?.savedParts === "number" ? r.data.savedParts : batch.end;
        await repo.applySyncResult(uid, id, { savedParts: saved });
        if (batch.done) break;
      } else if (cls === "conflict") {
        if (typeof r.data?.savedParts === "number" && ++conflicts <= 3) {
          saved = r.data.savedParts;
          await repo.applySyncResult(uid, id, { savedParts: saved });
          continue;
        }
        return "next";
      } else if (cls === "too-large") {
        if (maxParts <= 25) {
          await repo.applySyncResult(uid, id, { syncError: "rejected" });
          return "next";
        }
        maxParts = Math.max(25, Math.floor(maxParts / 2));
      } else if (cls === "not-found") {
        await repo.applySyncResult(uid, id, { savedParts: 0, markDirty: ["create"] });
        return "next";
      } else {
        return fail(uid, id, cls, r);
      }
    }
    await repo.applySyncResult(uid, id, { savedParts: saved, clear: ["tail"], readRev });
    cur = (await repo.getMeta(uid, id)) ?? cur;
  }

  if (cur.dirty.meta) {
    const r = await req("PATCH", url, { title: cur.title, titleUpdatedAt: cur.titleUpdatedAt });
    const cls = classifyResponse(r.status);
    if (cls === "ok") {
      okReset();
      await repo.applySyncResult(uid, id, {
        title: typeof r.data?.title === "string" ? r.data.title : cur.title,
        clear: ["meta"],
      });
    } else {
      return fail(uid, id, cls, r);
    }
  }

  if (cur.dirty.speakers) {
    const r = await req("PATCH", url, { speakerNames: cur.speakerNames ?? {} });
    const cls = classifyResponse(r.status);
    if (cls === "ok") {
      okReset();
      await repo.applySyncResult(uid, id, { clear: ["speakers"] });
    } else {
      return fail(uid, id, cls, r);
    }
  }

  if (cur.dirty.finish) {
    const latest = (await repo.getMeta(uid, id)) ?? cur;
    if (!latest.dirty.tail) {
      const r = await req("PATCH", url, { status: "DONE", durationSec: latest.durationSec });
      const cls = classifyResponse(r.status);
      if (cls === "ok") {
        okReset();
        await repo.applySyncResult(uid, id, { clear: ["finish"] });
      } else {
        return fail(uid, id, cls, r);
      }
    }
  }
  return "next";
}

async function pull(uid: string): Promise<Step> {
  const since = await repo.kvGet<string>(uid, "lastPullAt");
  const r = await req("GET", "/api/meetings" + (since ? `?since=${encodeURIComponent(since)}` : ""));
  const cls = classifyResponse(r.status);
  if (cls !== "ok") return fail(uid, "", cls === "bad-request" ? "retry" : cls, r);
  okReset();
  const data = r.data;
  if (!data || !Array.isArray(data.meetings) || !Array.isArray(data.ids)) return "next";
  const refetch = await repo.applyPull(uid, data.meetings, data.ids);
  for (const id of refetch.slice(0, 5)) {
    const fr = await req("GET", `/api/meetings/${encodeURIComponent(id)}`);
    if (classifyResponse(fr.status) === "ok" && fr.data?.meeting) {
      const mt = fr.data.meeting;
      await repo.cacheServerMeeting(uid, { ...mt, transcript: parseTranscript(mt.transcript) });
    } else if (classifyResponse(fr.status) === "auth") {
      return fail(uid, id, "auth", fr);
    }
  }
  const serverMs = Date.parse(data.serverTime);
  if (!Number.isNaN(serverMs)) {
    await repo.kvSet(uid, "lastPullAt", new Date(serverMs - 5000).toISOString());
    lastPullMs = Date.now();
  }
  return "next";
}

async function passBody(uid: string, force: boolean, ignoreBackoff: boolean): Promise<void> {
  if (!ignoreBackoff && Date.now() < nextAttemptAt) return;
  if (!(await isReachable({ force }))) {
    setSnapshot({ state: "offline" });
    return;
  }
  setSnapshot({ state: "syncing" });
  const pending = await repo.listPending(uid);
  for (const m of pending) {
    if (userId !== uid) return;
    if (m.syncError === "conflict") continue;
    if ((await syncMeeting(uid, m)) === "stop") return;
  }
  if (force || Date.now() - lastPullMs > PULL_EVERY_MS) {
    if ((await pull(uid)) === "stop") return;
  }
  setSnapshot({ state: "idle", lastSyncedAt: Date.now(), lastError: null });
}

async function lockedPass(uid: string, force: boolean, ignoreBackoff: boolean): Promise<void> {
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks?.request) {
      await locks.request(`transcriber-sync-${uid}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return; // another tab is syncing and will see our rows in the local store
        await passBody(uid, force, ignoreBackoff);
      });
    } else {
      await passBody(uid, force, ignoreBackoff);
    }
  } catch {
    setSnapshot({ state: "idle" });
  }
}

function runPass(opts?: { force?: boolean; ignoreBackoff?: boolean }): Promise<void> {
  if (!userId) return Promise.resolve();
  if (opts?.force) forcePending = true;
  if (running) {
    rerun = true;
    return currentPass ?? Promise.resolve();
  }
  running = true;
  const ignore = !!opts?.ignoreBackoff;
  currentPass = (async () => {
    try {
      do {
        rerun = false;
        const uid = userId;
        if (!uid) break;
        const force = forcePending;
        forcePending = false;
        await lockedPass(uid, force, ignore);
      } while (rerun);
    } finally {
      running = false;
      currentPass = null;
    }
  })();
  return currentPass;
}

export function poke(id?: string): void {
  void id;
  try {
    if (!userId) return;
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void runPass().catch(() => {});
    }, 50);
  } catch {
    /* never throws */
  }
}

function scheduleLoop() {
  if (timer) clearTimeout(timer);
  const base = snapshot.state === "needs-auth" ? 60_000 : activeRecordings.size > 0 ? 5_000 : 30_000;
  const wait = Math.max(base, nextAttemptAt - Date.now());
  timer = setTimeout(() => {
    void runPass().finally(() => {
      if (userId) scheduleLoop();
    });
  }, wait);
}

export function startSync(uid: string): void {
  if (typeof window === "undefined") return;
  if (userId === uid) return;
  stopSync();
  userId = uid;
  attempt = 0;
  nextAttemptAt = 0;
  lastPullMs = 0;
  setSnapshot({ userId: uid, state: "idle", lastError: null });

  teardown.push(
    onConnectivityHint((online) => {
      if (online) {
        forcePending = true;
        void runPass({ force: true, ignoreBackoff: true }).catch(() => {});
      } else {
        setSnapshot({ state: "offline" });
      }
    }),
  );
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      forcePending = true;
      poke();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  teardown.push(() => document.removeEventListener("visibilitychange", onVisible));

  if (hasPlugin("App")) {
    let cancelled = false;
    let removeApp: (() => void) | null = null;
    getApp()
      .then((app) => app.addListener("appStateChange", (s: { isActive: boolean }) => s.isActive && poke()))
      .then((h) => {
        if (cancelled) void h.remove();
        else removeApp = () => void h.remove();
      })
      .catch(() => {});
    teardown.push(() => {
      cancelled = true;
      removeApp?.();
    });
  }

  scheduleLoop();
  forcePending = true;
  poke();
}

export function stopSync(): void {
  for (const t of teardown) {
    try {
      t();
    } catch {
      /* ignore */
    }
  }
  teardown = [];
  if (timer) clearTimeout(timer);
  if (debounce) clearTimeout(debounce);
  timer = null;
  debounce = null;
  userId = null;
  setSnapshot({ userId: null, state: "idle" });
}

export function resumeAuth(): void {
  if (snapshot.state === "needs-auth") setSnapshot({ state: "idle", lastError: null });
  nextAttemptAt = 0;
  poke();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function flush(id: string, opts?: { timeoutMs?: number }): Promise<FlushResult> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 15_000);
  let wait = 2000;
  for (;;) {
    const uid = userId;
    if (!uid) return "pending";
    await runPass({ force: true, ignoreBackoff: true });
    const meta = await repo.getMeta(uid, id);
    if (!meta || meta.pending === 0) return "synced";
    if (meta.syncError === "conflict") return "conflict";
    if (snapshot.state === "needs-auth") return "needs-auth";
    if (Date.now() + wait > deadline) return "pending";
    await sleep(wait);
    wait += 2000;
  }
}
