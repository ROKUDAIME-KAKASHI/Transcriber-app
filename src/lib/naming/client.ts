"use client";

// Browser-side glue for screen naming: the per-device opt-in, the "may it run?" check, and the per-meeting
// statistics kept in the device's local database (never sent anywhere).

import { useSyncExternalStore } from "react";
import { getFlagNow } from "@/lib/flagsClient";
import { isNativeApp } from "@/lib/nativeRecorder";
import { kvGet, kvSet } from "@/lib/local/repo";
import { guidedCallAvailable } from "@/lib/tabAudio";
import { screenNamingActive, screenNamingOptedIn, setScreenNamingOptIn } from "./optIn";
import { noteRename, parseStats, type NamingStats } from "./stats";

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** [on, setOn] for the per-device "Read names from the call screen (beta)" switch. Default off. */
export function useScreenNamingOptIn(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => screenNamingOptedIn(store()), () => false);
  return [
    on,
    (next: boolean) => {
      setScreenNamingOptIn(store(), next);
      listeners.forEach((l) => l());
    },
  ];
}

/** True when this browser can do a guided tab recording at all (Chromium on a laptop, not the app). */
export function desktopChromiumNow(): boolean {
  if (typeof navigator === "undefined") return false;
  return guidedCallAvailable({
    native: isNativeApp(),
    userAgent: navigator.userAgent,
    coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
  });
}

/** Whether naming may run for a recording that is about to start (flag on, device opted in, guided tab, laptop Chromium). */
export function screenNamingAllowedNow(guided: boolean): boolean {
  return screenNamingActive({
    flag: getFlagNow("screenNaming"),
    optIn: screenNamingOptedIn(store()),
    guided,
    desktopChromium: desktopChromiumNow(),
  });
}

// ---- Per-meeting statistics (device only) ----------------------------------------------------------------

const kvKey = (meetingId: string) => `naming:${meetingId}`;

export async function saveNamingStats(userId: string, meetingId: string, stats: NamingStats): Promise<void> {
  await kvSet(userId, kvKey(meetingId), stats);
}

export async function loadNamingStats(userId: string, meetingId: string): Promise<NamingStats | null> {
  return parseStats(await kvGet<unknown>(userId, kvKey(meetingId)));
}

/** The user renamed voices after the recording: count it as a change when a voice had an automatic name. */
export async function recordNamingRename(userId: string, meetingId: string, updates: Record<number, string>): Promise<void> {
  try {
    const s = await loadNamingStats(userId, meetingId);
    if (!s) return;
    let touched = false;
    for (const [k, name] of Object.entries(updates)) {
      if (noteRename(s, Number(k), name)) touched = true;
    }
    if (touched) await saveNamingStats(userId, meetingId, s);
  } catch {
    /* statistics are best effort */
  }
}
