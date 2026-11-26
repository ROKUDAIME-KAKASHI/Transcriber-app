"use client";

import { useSyncExternalStore } from "react";

/** The user's own name ("You" until set). The server copy is User.displayName; this keeps it for offline use. */
const KEY = "minutely.displayName";
const listeners = new Set<() => void>();

export function cachedDisplayName(): string {
  try {
    return localStorage.getItem(KEY) || "You";
  } catch {
    return "You";
  }
}

export function cacheDisplayName(name: string): void {
  try {
    if (name && name !== "You") localStorage.setItem(KEY, name);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Asks the server, remembers the answer, and returns it. Throws when offline (use cachedDisplayName then). */
export async function refreshDisplayName(): Promise<string> {
  const res = await fetch("/api/profile/name", { cache: "no-store" });
  const d = (await res.json().catch(() => null)) as { name?: string } | null;
  if (!res.ok || !d?.name) throw new Error("unavailable");
  cacheDisplayName(d.name);
  return d.name;
}

/** The remembered custom name, or null when it is still "You". */
export function useCustomName(): string | null {
  const n = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    cachedDisplayName,
    () => "You"
  );
  return n === "You" ? null : n;
}
