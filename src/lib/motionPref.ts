"use client";

/** Reduce-motion preference. Only the literal "reduced" changes behaviour; anything else is "auto". */
import { useSyncExternalStore } from "react";

export const MOTION_KEY = "transcriber.motion";

export type MotionPref = "reduced" | "auto";

const listeners = new Set<() => void>();

export function getMotionPref(): MotionPref {
  try {
    if (typeof localStorage === "undefined") return "auto";
    return localStorage.getItem(MOTION_KEY) === "reduced" ? "reduced" : "auto";
  } catch {
    return "auto";
  }
}

export function setMotionPref(v: MotionPref): void {
  try {
    if (v === "reduced") localStorage.setItem(MOTION_KEY, "reduced");
    else localStorage.removeItem(MOTION_KEY);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== "undefined") {
    if (v === "reduced") document.documentElement.dataset.motion = "reduced";
    else delete document.documentElement.dataset.motion;
  }
  listeners.forEach((l) => l());
}

const MQ = "(prefers-reduced-motion: reduce)";

function systemReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MQ).matches;
}

/** Non-hook check for imperative animations. */
export function prefersReducedMotion(): boolean {
  return getMotionPref() === "reduced" || systemReduced();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(MQ) : null;
  mq?.addEventListener("change", cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MOTION_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener("change", cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMotionPref(): { pref: MotionPref; setPref: (v: MotionPref) => void; reduced: boolean } {
  const pref = useSyncExternalStore<MotionPref>(subscribe, getMotionPref, () => "auto");
  const sys = useSyncExternalStore<boolean>(subscribe, systemReduced, () => false);
  return { pref, setPref: setMotionPref, reduced: pref === "reduced" || sys };
}
