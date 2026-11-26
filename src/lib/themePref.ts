"use client";

/** Light / dark / system choice. Saved on this device; data-theme on <html> drives the CSS (see globals.css). */
import { useSyncExternalStore } from "react";
import { THEME_COLORS, THEME_KEY, parseTheme, resolveTheme, type ThemePref } from "./theme";

const MQ = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  try {
    return typeof localStorage === "undefined" ? "system" : parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

function systemDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MQ).matches;
}

/** Sets data-theme and the browser's theme-color to match. "system" removes the attribute and restores per-scheme colours. */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const color =
      pref === "system"
        ? m.media.includes("dark")
          ? THEME_COLORS.dark
          : THEME_COLORS.light
        : THEME_COLORS[resolveTheme(pref, systemDark())];
    m.setAttribute("content", color);
  });
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(MQ) : null;
  mq?.addEventListener("change", cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(getThemePref());
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener("change", cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme(): { pref: ThemePref; resolved: "light" | "dark"; systemDark: boolean; setPref: (p: ThemePref) => void } {
  const pref = useSyncExternalStore<ThemePref>(subscribe, getThemePref, () => "system");
  const sys = useSyncExternalStore<boolean>(subscribe, systemDark, () => false);
  return { pref, resolved: resolveTheme(pref, sys), systemDark: sys, setPref: setThemePref };
}
