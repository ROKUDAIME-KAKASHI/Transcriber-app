import { LATEST_APK } from "@/lib/appRelease";
import { absoluteUrl, isOlderBuild, newerRelease, parseApkRelease, type ApkRelease } from "@/lib/appVersion";
import { DocumentExport, getApp, hasPlugin } from "@/lib/native";

/** Installed APK version, or null on the website. Unknown native version counts as build 1 with no name. */
export async function getInstalledVersion(): Promise<{ code: number; name: string | null } | null> {
  if (!hasPlugin("App")) return null;
  try {
    const info = await (await getApp()).getInfo();
    const n = parseInt(info.build, 10);
    const name = typeof info.version === "string" && info.version.trim() ? info.version.trim() : null;
    return { code: Number.isFinite(n) && n > 0 ? n : 1, name };
  } catch {
    return { code: 1, name: null };
  }
}

/** versionCode of the installed APK, or null on the website. Unknown native version counts as 1. */
export async function getInstalledVersionCode(): Promise<number | null> {
  return (await getInstalledVersion())?.code ?? null;
}

export function isUpdateAvailable(installed: number | null, latest = LATEST_APK.versionCode): boolean {
  return isOlderBuild(installed, latest);
}

const LATEST_TTL_MS = 10 * 60_000;
let latestCache: { at: number; release: ApkRelease } | null = null;

/**
 * Newest release: the server's /api/app/latest when reachable (so a long-open app sees new builds
 * without a reload), never older than the bundled LATEST_APK. `fresh` skips the 10-minute memo.
 * `fromServer` is false when the request failed and the bundled/last-known release is returned.
 */
export async function getLatestApk(opts: { fresh?: boolean } = {}): Promise<{ release: ApkRelease; fromServer: boolean }> {
  if (!opts.fresh && latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) {
    return { release: latestCache.release, fromServer: true };
  }
  try {
    const res = await fetch("/api/app/latest", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("bad status");
    const release = newerRelease(LATEST_APK, parseApkRelease(await res.json()));
    latestCache = { at: Date.now(), release };
    return { release, fromServer: true };
  } catch {
    return { release: latestCache?.release ?? LATEST_APK, fromServer: false };
  }
}

const dismissKey = (code: number) => `appUpdateDismissed:${code}`;

export function isUpdateDismissed(code: number = LATEST_APK.versionCode): boolean {
  try {
    return localStorage.getItem(dismissKey(code)) === "1";
  } catch {
    return false;
  }
}

export function rememberUpdateDismissed(code: number = LATEST_APK.versionCode): void {
  try {
    localStorage.setItem(dismissKey(code), "1");
  } catch {
    /* ignore */
  }
}

/** "opened" = system browser launched; "copied" = old APK, link copied; "failed" = nothing worked. */
export async function startApkUpdate(release: ApkRelease = LATEST_APK): Promise<"opened" | "copied" | "failed"> {
  const abs = absoluteUrl(window.location.origin, release.url);
  if (hasPlugin("DocumentExport")) {
    try {
      await DocumentExport.openExternal({ url: abs });
      return "opened";
    } catch {
      /* old APK without openExternal: fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(abs);
    return "copied";
  } catch {
    return "failed";
  }
}
