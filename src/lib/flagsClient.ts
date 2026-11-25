"use client";

import { useSyncExternalStore } from "react";
import { defaultFlags, parseFlags, type FlagKey, type Flags } from "./flagsCore";

const KEY = "transcriber.flags";
const REFRESH_MS = 5 * 60_000;

let state: Flags | null = null;
let fetchedAt = 0;
const listeners = new Set<() => void>();

function current(): Flags {
  if (state) return state;
  let cached: Flags | null = null;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) cached = parseFlags(JSON.parse(raw));
  } catch {
    /* unreadable cache: use defaults */
  }
  state = cached ?? defaultFlags();
  return state;
}

function refresh(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - fetchedAt < REFRESH_MS) return;
  fetchedAt = now;
  void fetch("/api/flags")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return;
      const next = parseFlags(j);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage full or blocked */
      }
      if (JSON.stringify(next) !== JSON.stringify(current())) {
        state = next;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {
      fetchedAt = 0; // offline: try again on the next mount; cached or default values stay in use
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  refresh();
  return () => {
    listeners.delete(cb);
  };
}

/** Non-hook read for code outside React render (cached value, or defaults before the first fetch). */
export function getFlagNow(key: FlagKey): boolean {
  refresh();
  return current()[key];
}

/** Whether a feature is switched on. Defaults (all on) while loading; the last known value is cached in localStorage. */
export function useFlag(key: FlagKey): boolean {
  return useSyncExternalStore(subscribe, () => current()[key], () => defaultFlags()[key]);
}
