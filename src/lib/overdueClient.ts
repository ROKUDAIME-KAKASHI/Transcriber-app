"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useFlag } from "./flagsClient";
import { useConnectivity } from "./connectivity";
import { localToday } from "./taskTracker";
import { isRecordingActive } from "./recordingFlag";
import { parseSummary, type OverdueSummary } from "./trackerPlus";

/**
 * Overdue task count for the Tasks badge, the daily toast and the Record line. One shared copy, cached 5 minutes,
 * fetched only online with the tracker and its upgrades switched on and the user's reminder switch on.
 * Any failure (paused, offline, not migrated) just means "no count": nothing is shown.
 */
const TTL_MS = 5 * 60_000;
const PREF_KEY = "transcriber.overdueReminders";

let summary: OverdueSummary | null = null;
let fetchedAt = 0;
let cachedFor: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/* ---------- the user's switch (this device only) ---------- */

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

let prefState: boolean | null = null;
const getPref = () => (prefState ??= readPref());

export function setOverdueReminders(on: boolean): void {
  prefState = on;
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the switch still works until reload */
  }
  emit();
}

/** [on, setOn] for the Profile switch. Defaults to on. */
export function useOverdueReminders(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getPref, () => true);
  return [on, setOverdueReminders];
}

/* ---------- the count ---------- */

function refresh(force: boolean): void {
  if (typeof window === "undefined" || inflight) return;
  if (!force && Date.now() - fetchedAt < TTL_MS) return;
  const owner = cachedFor;
  // Never touch the network while a recording is running; the next resume/edit catches up.
  inflight = isRecordingActive()
    .catch(() => true)
    .then(async (recording) => {
      if (recording) return;
      fetchedAt = Date.now(); // also backs off for 5 minutes after a failure
      const r = await fetch(`/api/action-items/summary?today=${localToday()}`, { cache: "no-store" });
      const next = r.ok ? parseSummary(await r.json().catch(() => null)) : null;
      if (cachedFor !== owner) return; // a different account signed in meanwhile
      summary = next;
      emit();
    })
    .catch(() => {
      /* offline or failed: keep what we had */
    })
    .finally(() => {
      inflight = null;
    });
}

/** Call after a task changes so the badge catches up straight away. */
export function invalidateOverdue(): void {
  fetchedAt = 0;
  refresh(true);
}

/** Forget everything (a different account signed in). */
function reset(userKey: string | null): void {
  if (cachedFor === userKey) return;
  cachedFor = userKey;
  summary = null;
  fetchedAt = 0;
  inflight = null;
}

/**
 * The overdue summary, or null when it should not be shown: reminders off, features off, offline, no data yet.
 * `userKey` separates accounts that share a device.
 */
export function useOverdueSummary(userKey: string | null): OverdueSummary | null {
  const trackerOn = useFlag("taskTracker");
  const plusOn = useFlag("trackerPlus");
  const online = useConnectivity() !== "offline";
  const wanted = useSyncExternalStore(subscribe, getPref, () => true);
  const snap = useSyncExternalStore(subscribe, () => summary, () => null);
  const active = trackerOn && plusOn && online && wanted && !!userKey;

  useEffect(() => {
    if (!active) return;
    reset(userKey);
    refresh(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, userKey]);

  return active && cachedFor === userKey ? snap : null;
}
