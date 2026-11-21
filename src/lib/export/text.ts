import { transcriptToText } from "@/lib/transcript";
import type { ExportFile, ExportMeeting, ExportTarget } from "./types";

export const fileStamp = () => new Date().toISOString().slice(0, 10);

export function exportFileName(base: string, ext: string): string {
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "") || "Export";
  return `${safe}-${fileStamp()}.${ext}`;
}

export function targetText(target: ExportTarget, meeting: ExportMeeting): string {
  return target === "document" ? (meeting.document ?? "") : transcriptToText(meeting.transcript, { names: meeting.speakerNames });
}

export function buildTxt(target: ExportTarget, meeting: ExportMeeting, base: string): ExportFile {
  const text = targetText(target, meeting);
  const mime = "text/plain;charset=utf-8";
  return { kind: "txt", name: exportFileName(base, "txt"), mime, blob: new Blob([text], { type: mime }), text };
}
