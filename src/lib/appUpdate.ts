import { LATEST_APK } from "@/lib/appRelease";
import { DocumentExport, getApp, hasPlugin } from "@/lib/native";

/** versionCode of the installed APK, or null on the website. Unknown native version counts as 1. */
export async function getInstalledVersionCode(): Promise<number | null> {
  if (!hasPlugin("App")) return null;
  try {
    const info = await (await getApp()).getInfo();
    const n = parseInt(info.build, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

export function isUpdateAvailable(installed: number | null, latest = LATEST_APK.versionCode): boolean {
  return installed !== null && installed < latest;
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
export async function startApkUpdate(): Promise<"opened" | "copied" | "failed"> {
  const abs = window.location.origin + LATEST_APK.url;
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
