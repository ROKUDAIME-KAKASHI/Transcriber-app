"use client";

import { useSyncExternalStore } from "react";
import type { ExtractedItem } from "./actionItems.ts";
import type { MeetingSummary } from "./combined.ts";

/**
 * The summary and the action-item candidates from the combined request live on this device only (no schema
 * change). The minutes themselves are saved to the meeting as before.
 */

export interface Extras {
  summary: MeetingSummary | null;
  /** Items waiting for the user's review. Cleared when they are saved. Never saved as tasks automatically. */
  items: ExtractedItem[] | null;
}

const EMPTY: Extras = { summary: null, items: null };
const PREFIX = "minutely.extras.";
const ASK_PREFIX = "minutely.ask.";
/** Keyed by account so another user on the same device never sees it. */
const key = (userId: string, id: string) => `${PREFIX}${userId}.${id}`;
const MAX_AGE_MS = 30 * 24 * 3600_000;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Extras }>();

function emit() {
  listeners.forEach((l) => l());
}

export function readExtras(userId: string | null, id: string): Extras {
  if (!userId || typeof localStorage === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(userId, id));
  } catch {
    return EMPTY;
  }
  const ck = key(userId, id);
  const hit = cache.get(ck);
  if (hit && hit.raw === raw) return hit.value;
  let value = EMPTY;
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Extras>) : null;
    if (v && typeof v === "object") {
      value = {
        summary: v.summary && typeof v.summary === "object" ? (v.summary as MeetingSummary) : null,
        items: Array.isArray(v.items) ? (v.items as ExtractedItem[]) : null,
      };
    }
  } catch {
    value = EMPTY;
  }
  cache.set(ck, { raw, value });
  return value;
}

export function writeExtras(userId: string | null, id: string, patch: Partial<Extras>): void {
  if (!userId) return;
  const next = { ...readExtras(userId, id), ...patch };
  try {
    if (!next.summary && !next.items) localStorage.removeItem(key(userId, id));
    else localStorage.setItem(key(userId, id), JSON.stringify({ ...next, at: Date.now() }));
  } catch {
    /* storage full or blocked: the result is simply not remembered */
  }
  emit();
}

export function useExtras(userId: string | null, id: string): Extras {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key(userId ?? "", id) && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => readExtras(userId, id),
    () => EMPTY
  );
}

/** True for a stored key that must go: not scoped to an account (older build), or untouched for a month. */
export function isStaleLocalKey(k: string, raw: string | null, now: number): boolean {
  for (const p of [PREFIX, ASK_PREFIX]) {
    if (!k.startsWith(p)) continue;
    if (!k.slice(p.length).includes(".")) return true;
    try {
      const at = (JSON.parse(raw ?? "null") as { at?: unknown } | null)?.at;
      if (typeof at === "number" && now - at > MAX_AGE_MS) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Remove unscoped and old per-meeting leftovers (summary, pending items, chat). Call once per sign-in. */
export function sweepLocalMeetingData(): void {
  try {
    const now = Date.now();
    const dead: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isStaleLocalKey(k, localStorage.getItem(k), now)) dead.push(k);
    }
    for (const k of dead) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
