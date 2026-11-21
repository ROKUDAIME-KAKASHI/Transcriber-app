import { ExportError } from "./deliver";
import { exportFileName, buildTxt, targetText } from "./text";
import type { ExportFile, ExportKind, ExportMeeting, ExportTarget } from "./types";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function buildExport(o: { kind: ExportKind; target: ExportTarget; meeting: ExportMeeting }): Promise<ExportFile> {
  const { kind, target, meeting } = o;
  const base = target === "document" ? meeting.docName : "Transcript";
  try {
    switch (kind) {
      case "txt":
        return buildTxt(target, meeting, base);
      case "docx": {
        const { buildMinutesDocx, buildTranscriptDocx } = await import("./docx");
        const blob =
          target === "document"
            ? await buildMinutesDocx({ title: meeting.title, markdown: meeting.document ?? "" })
            : await buildTranscriptDocx({ title: meeting.title, parts: meeting.transcript, names: meeting.speakerNames });
        return { kind: "docx", name: exportFileName(base, "docx"), mime: DOCX_MIME, blob, text: targetText(target, meeting) };
      }
      case "pdf": {
        const { buildMinutesHtml, buildTranscriptHtml } = await import("./html");
        const html =
          target === "document"
            ? await buildMinutesHtml({ title: meeting.title, markdown: meeting.document ?? "" })
            : buildTranscriptHtml({ title: meeting.title, parts: meeting.transcript, names: meeting.speakerNames });
        return { kind: "pdf", name: exportFileName(base, "pdf"), html, text: targetText(target, meeting) };
      }
    }
  } catch (e) {
    if (e instanceof ExportError) throw e;
    throw new ExportError("BUILD_FAILED", String((e as Error)?.message ?? e));
  }
}
