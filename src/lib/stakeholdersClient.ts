"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useFlag } from "./flagsClient";
import type { Person } from "./stakeholders";

/**
 * Shared, lightly cached copy of the directory for pickers. "unavailable" (flag off, offline, table not migrated,
 * or any error) means the picker falls back to a plain text field, exactly like before the directory existed.
 */
export type PeopleState = { status: "idle" | "loading" | "ready" | "unavailable"; people: Person[] };

const TTL_MS = 60_000;
let state: PeopleState = { status: "idle", people: [] };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: PeopleState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshPeople(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight) return inflight;
  if (!force && state.status === "ready" && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (state.status === "idle") set({ status: "loading", people: [] });
  inflight = fetch("/api/stakeholders", { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { people?: Person[] };
      fetchedAt = Date.now();
      set({ status: "ready", people: Array.isArray(j.people) ? j.people : [] });
    })
    .catch(() => {
      fetchedAt = 0;
      // Keep an earlier good list when a refresh fails; otherwise fall back to free text.
      if (state.status !== "ready") set({ status: "unavailable", people: [] });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Call after adding, editing or deleting a person so every picker sees it. */
export function invalidatePeople(): void {
  fetchedAt = 0;
  void refreshPeople(true);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const SERVER: PeopleState = { status: "idle", people: [] };

/** The directory for pickers. Only fetches when the `stakeholders` flag is on and the caller is mounted. */
export function usePeople(enabled = true): PeopleState {
  const on = useFlag("stakeholders");
  const snap = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const active = enabled && on;
  useEffect(() => {
    if (active) void refreshPeople();
  }, [active]);
  if (!active) return SERVER;
  return snap;
}
