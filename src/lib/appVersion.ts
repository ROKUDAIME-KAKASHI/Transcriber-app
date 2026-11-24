// Pure helpers for app version / update decisions. No imports so node tests can load it directly.

export interface ApkRelease {
  versionCode: number;
  versionName: string;
  url: string;
  notes: string;
}

/** True when the installed build is older than the latest one. Null installed means the website. */
export function isOlderBuild(installed: number | null, latest: number): boolean {
  return installed !== null && installed < latest;
}

/** Validates an untrusted /api/app/latest payload. Returns null when it is not a usable release. */
export function parseApkRelease(x: unknown): ApkRelease | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const code = o.versionCode;
  if (typeof code !== "number" || !Number.isInteger(code) || code < 1) return null;
  if (typeof o.versionName !== "string" || !o.versionName.trim()) return null;
  if (typeof o.url !== "string" || !o.url.startsWith("/")) return null;
  return {
    versionCode: code,
    versionName: o.versionName.trim().slice(0, 40),
    url: o.url,
    notes: typeof o.notes === "string" ? o.notes.slice(0, 400) : "",
  };
}

/** The newer of two releases by versionCode (the bundled one wins ties). */
export function newerRelease(bundled: ApkRelease, fetched: ApkRelease | null): ApkRelease {
  return fetched && fetched.versionCode > bundled.versionCode ? fetched : bundled;
}

export function isAndroidUserAgent(ua: string): boolean {
  return /\bAndroid\b/i.test(ua);
}

export function absoluteUrl(origin: string, path: string): string {
  return origin.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

/** "1.1 (build 2)", or a fallback when the installed version could not be read. */
export function describeInstalled(v: { code: number; name: string | null } | null): string {
  if (!v) return "";
  if (!v.name) return v.code <= 1 ? "1.0 or older" : `build ${v.code}`;
  return `${v.name} (build ${v.code})`;
}
