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
const key = (id: string) => `minutely.extras.${id}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Extras }>();

function emit() {
  listeners.forEach((l) => l());
}

export function readExtras(id: string): Extras {
  if (typeof localStorage === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(id));
  } catch {
    return EMPTY;
  }
  const hit = cache.get(id);
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
  cache.set(id, { raw, value });
  return value;
}

export function writeExtras(id: string, patch: Partial<Extras>): void {
  const next = { ...readExtras(id), ...patch };
  try {
    if (!next.summary && !next.items) localStorage.removeItem(key(id));
    else localStorage.setItem(key(id), JSON.stringify(next));
  } catch {
    /* storage full or blocked: the result is simply not remembered */
  }
  emit();
}

export function useExtras(id: string): Extras {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key(id) && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => readExtras(id),
    () => EMPTY
  );
}
