import { unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import { docxXmlToText, type ReferenceKind } from "./prework";

/** Server-side text extraction. Throws on a file it can't read; never logs or returns anything but text. */

const MAX_XML_BYTES = 40 * 1024 * 1024;

export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export function docxToText(data: Uint8Array): string {
  // Only word/document.xml is inflated, and only if it is not absurdly large (zip bombs).
  const files = unzipSync(data, { filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_XML_BYTES });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("not a Word document");
  return docxXmlToText(new TextDecoder("utf-8").decode(xml));
}

export async function fileToText(kind: ReferenceKind, data: Uint8Array): Promise<string> {
  if (kind === "pdf") return pdfToText(data);
  if (kind === "docx") return docxToText(data);
  return new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, "");
}
