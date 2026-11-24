import { Capacitor, registerPlugin } from "@capacitor/core";

export type PluginName = "Share" | "Filesystem" | "App" | "Network" | "Haptics" | "DocumentExport" | "MeetingRecorder";

export function isNative(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

// Web implementations make isPluginAvailable true on the website, so require native too.
export function hasPlugin(name: PluginName): boolean {
  return isNative() && Capacitor.isPluginAvailable(name);
}

export async function getShare() {
  return (await import("@capacitor/share")).Share;
}
export async function getFilesystem() {
  const m = await import("@capacitor/filesystem");
  return { Filesystem: m.Filesystem, Directory: m.Directory };
}
export async function getApp() {
  return (await import("@capacitor/app")).App;
}
export async function getNetwork() {
  return (await import("@capacitor/network")).Network;
}
export async function getHaptics() {
  return (await import("@capacitor/haptics")).Haptics;
}

export interface DocumentExportPlugin {
  htmlToPdf(o: { html: string; fileName: string }): Promise<{ uri: string }>;
  printHtml(o: { html: string; jobName: string }): Promise<{ started: boolean }>;
  /** Added in APK versionCode 2; older installs reject with "not implemented". */
  openExternal(o: { url: string }): Promise<void>;
}
// Rejection codes: "BUSY" | "CANCELLED" | "LAYOUT_FAILED" | "WRITE_FAILED" | "IO" | "TIMEOUT" | "SHIM_FAILED" | "BAD_ARGS"
export const DocumentExport = registerPlugin<DocumentExportPlugin>("DocumentExport");

export const EXPORTS_DIR = "exports";

export async function cleanupOldExports(): Promise<void> {
  try {
    if (!hasPlugin("Filesystem")) return;
    const { Filesystem, Directory } = await getFilesystem();
    let files: { name: string; mtime?: number }[] = [];
    try {
      files = (await Filesystem.readdir({ path: EXPORTS_DIR, directory: Directory.Cache })).files;
    } catch {
      return;
    }
    const cutoff = Date.now() - 86_400_000;
    for (const f of files) {
      if (typeof f.mtime === "number" && f.mtime < cutoff) {
        try {
          await Filesystem.deleteFile({ path: `${EXPORTS_DIR}/${f.name}`, directory: Directory.Cache });
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* never throws */
  }
}
