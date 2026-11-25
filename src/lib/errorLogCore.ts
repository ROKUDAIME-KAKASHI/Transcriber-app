// Pure helpers for the error log. No imports so node tests can load it directly.

export const ERROR_KINDS = ["error", "unhandledrejection", "boundary", "api"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const LIMITS = { message: 500, stack: 4000, url: 500, userAgent: 300, appVersion: 40 } as const;

export const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** Keeps origin-less path only: drops the query string and the #fragment (they can hold tokens or ids). */
export function sanitizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  try {
    const u = new URL(s, "http://x.invalid");
    s = u.origin === "http://x.invalid" && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? u.pathname : `${u.origin}${u.pathname}`;
  } catch {
    s = s.split(/[?#]/)[0];
  }
  return clip(s, LIMITS.url);
}

/** Removes obvious secrets from a free-text message: query strings and long token-like runs. */
export function scrubMessage(raw: string): string {
  const s = String(raw)
    .replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/gi, "$1")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
  return clip(s, LIMITS.message);
}

/** First meaningful stack frame, with line/column and query strings removed so deploys of the same bug match. */
export function topFrame(stack: string | undefined | null): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((l) => l.trim());
  const frame = lines.find((l) => /^at\s|@/.test(l) && !/node_modules/.test(l)) ?? lines.find((l) => /^at\s|@/.test(l)) ?? "";
  return frame
    .replace(/\?[^\s):]*/g, "")
    .replace(/:\d+(:\d+)?\)?$/, "")
    .replace(/[A-Za-z0-9_-]{16,}\.js/g, "chunk.js")
    .slice(0, 200);
}

/** FNV-1a 64-bit-ish (two 32-bit lanes) hex hash. Not cryptographic; groups the same error together. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Same bug => same fingerprint: kind + normalised message (digits and long ids collapsed) + top frame. */
export function fingerprint(kind: string, message: string, stack?: string | null): string {
  const norm = message.replace(/\d+/g, "N").replace(/[A-Za-z0-9_-]{20,}/g, "ID").trim().toLowerCase();
  return hashString(`${kind}|${norm}|${topFrame(stack)}`);
}

/** In-session dedupe plus a cap per page load. Returns true if this report should be sent. */
export function createReportGate(max = 10) {
  const seen = new Set<string>();
  return {
    allow(key: string): boolean {
      if (seen.has(key) || seen.size >= max) return false;
      seen.add(key);
      return true;
    },
  };
}
