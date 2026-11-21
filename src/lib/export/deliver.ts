import { DocumentExport, EXPORTS_DIR, getFilesystem, getShare, hasPlugin, isNative } from "@/lib/native";
import { preloadDocx } from "./docx";
import type { DeliverResult, ExportErrorCode, ExportFile } from "./types";

export class ExportError extends Error {
  code: ExportErrorCode;
  constructor(code: ExportErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ExportError";
    this.code = code;
  }
}

export function nativeFileShareMissing(): boolean {
  return isNative() && !(hasPlugin("Filesystem") && hasPlugin("Share"));
}
export function nativePdfMissing(): boolean {
  return isNative() && !(hasPlugin("DocumentExport") && hasPlugin("Share"));
}
export function webCanShareFiles(): boolean {
  if (isNative() || typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File(["x"], "probe.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

export function preloadExport(): void {
  preloadDocx();
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

function isCancel(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const x = e as { message?: string; code?: string } | null;
  // Exact known cancel signals only; a loose /cancel/ match hides real failures.
  return !!x && (x.code === "CANCELLED" || x.message === "Share canceled" || x.message === "Share cancelled");
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away breaks downloads on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function shareFileUri(uri: string, title: string): Promise<DeliverResult> {
  try {
    const Share = await getShare();
    await Share.share({ title, files: [uri], dialogTitle: "Share" });
    return "ok";
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    throw new ExportError("SHARE_FAILED", String((e as Error)?.message ?? e));
  }
}

function printHtmlWeb(html: string): DeliverResult {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    iframe.remove();
  };
  iframe.onload = () => {
    const w = iframe.contentWindow;
    if (!w) return cleanup();
    w.addEventListener("afterprint", cleanup);
    w.focus();
    w.print();
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  setTimeout(cleanup, 60_000);
  return "printed";
}

async function deliverPdfNative(file: Extract<ExportFile, { kind: "pdf" }>, title: string): Promise<DeliverResult> {
  if (nativePdfMissing()) throw new ExportError("PDF_PLUGIN_MISSING");
  let uri: string;
  try {
    ({ uri } = await DocumentExport.htmlToPdf({ html: file.html, fileName: file.name }));
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "CANCELLED") return "cancelled";
    if (code === "LAYOUT_FAILED" || code === "WRITE_FAILED" || code === "IO" || code === "TIMEOUT" || code === "SHIM_FAILED") {
      try {
        await DocumentExport.printHtml({ html: file.html, jobName: file.name });
        return "printed";
      } catch {
        throw new ExportError("BUILD_FAILED");
      }
    }
    throw new ExportError("BUILD_FAILED", String((e as Error)?.message ?? e));
  }
  return shareFileUri(uri, title);
}

export async function shareOrSave(file: ExportFile, title: string): Promise<DeliverResult> {
  if (file.kind === "pdf") {
    return isNative() ? deliverPdfNative(file, title) : printHtmlWeb(file.html);
  }
  if (isNative()) {
    if (nativeFileShareMissing()) throw new ExportError("PLUGIN_MISSING");
    let uri: string;
    try {
      const { Filesystem, Directory } = await getFilesystem();
      ({ uri } = await Filesystem.writeFile({
        path: `${EXPORTS_DIR}/${file.name}`,
        data: await toBase64(file.blob),
        directory: Directory.Cache,
        recursive: true,
      }));
    } catch (e) {
      throw new ExportError("BUILD_FAILED", String((e as Error)?.message ?? e));
    }
    return shareFileUri(uri, title);
  }
  const type = file.mime;
  const f = new File([file.blob], file.name, { type });
  if (webCanShareFiles() && navigator.canShare({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title });
      return "ok";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        throw new ExportError("SHARE_FAILED", String((e as Error)?.message ?? e));
      }
      // NotAllowedError (no user activation left): fall through to a download.
    }
  }
  downloadBlob(file.blob, file.name);
  return "ok";
}

export function copyTextSync(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  if (!copyTextSync(text)) throw new ExportError("COPY_FAILED");
}

export async function shareText(text: string, title: string): Promise<DeliverResult> {
  try {
    if (isNative() && hasPlugin("Share")) {
      const Share = await getShare();
      await Share.share({ title, text, dialogTitle: "Share" });
      return "ok";
    }
    if (!isNative() && typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return "ok";
    }
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    throw new ExportError("SHARE_FAILED", String((e as Error)?.message ?? e));
  }
  await copyText(text);
  return "copied";
}
