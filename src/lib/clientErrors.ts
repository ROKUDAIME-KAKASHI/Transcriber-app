"use client";

import { createReportGate, type ErrorKind } from "./errorLogCore";
import { getInstalledVersion } from "./appUpdate";

const gate = createReportGate(10);
let version: string | undefined;

/** Resolves the installed app version once ("web" in a browser). */
export function initErrorVersion(): void {
  if (version) return;
  void getInstalledVersion()
    .then((v) => {
      version = v ? `app ${v.name ?? v.code}` : "web";
    })
    .catch(() => {
      version = "web";
    });
}

/**
 * Sends one error to the server log. Never throws, never sends transcript text, form values or tokens:
 * only the error's own message/stack and the page path (query string and fragment are dropped).
 */
export function reportClientError(kind: ErrorKind, error: unknown): void {
  try {
    const e = error instanceof Error ? error : null;
    const message = (e?.message ?? (typeof error === "string" ? error : "Unknown error")).slice(0, 500);
    const stack = e?.stack?.slice(0, 4000);
    const key = `${kind}|${message}|${stack?.split("\n")[1] ?? ""}`;
    if (!gate.allow(key)) return;
    const body = JSON.stringify({
      kind,
      message,
      stack,
      url: `${location.origin}${location.pathname}`,
      appVersion: version,
    });
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never break the app */
  }
}
