import type { SpeakerNames, TranscriptPart } from "@/lib/transcript";

export type ExportKind = "txt" | "docx" | "pdf";
export type ExportTarget = "document" | "transcript";
export type ExportFile =
  | { kind: "txt" | "docx"; name: string; mime: string; blob: Blob; text: string }
  | { kind: "pdf"; name: string; html: string; text: string }; // text = plain fallback for clipboard
export interface ExportMeeting {
  title: string;
  transcript: TranscriptPart[];
  document: string | null;
  docName: "Minutes" | "Report";
  speakerNames?: SpeakerNames;
}
export type DeliverResult = "ok" | "cancelled" | "printed" | "copied";
export type ExportErrorCode = "PLUGIN_MISSING" | "PDF_PLUGIN_MISSING" | "BUILD_FAILED" | "SHARE_FAILED" | "COPY_FAILED";
