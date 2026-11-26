/** Pure theme helpers. No imports, so node:test can load them. */

export const THEME_KEY = "transcriber.theme";

export type ThemePref = "system" | "light" | "dark";

/** Matches --background in globals.css (light and dark). */
export const THEME_COLORS = { light: "#f7f7fb", dark: "#0e0f17" } as const;

/** Only the literal "light" or "dark" is a choice; anything else (or nothing) is "system". */
export function parseTheme(v: unknown): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/** The quick sun/moon button: flips what you see now, and keeps that as an explicit choice. */
export function toggleTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return resolveTheme(pref, systemDark) === "dark" ? "light" : "dark";
}

/**
 * Runs inline in <head> before first paint: sets data-theme from the saved choice so the page doesn't flash.
 * "system" leaves the attribute off, and the CSS follows the OS. Never throws (storage can be blocked).
 */
export const THEME_INIT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark"){var d=document.documentElement;d.setAttribute("data-theme",t);` +
  `var c=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};` +
  `document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}}catch(e){}`;
