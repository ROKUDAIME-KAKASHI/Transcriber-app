import { Unzip, UnzipInflate } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import { docxXmlToText, type ReferenceKind } from "./prework.ts";

/** Server-side text extraction. Throws on a file it can't read; never logs or returns anything but text. */

/** Cap on the inflated size of word/document.xml (counted on real output, not the zip header). */
export const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
const PDF_TIMEOUT_MS = 30_000;

const hasPrefix = (d: Uint8Array, s: string) => d.length >= s.length && [...s].every((c, i) => d[i] === c.charCodeAt(0));

/** Magic-byte check so a renamed file is refused before a parser sees it. */
export function sniffMatches(kind: ReferenceKind, data: Uint8Array): boolean {
  if (kind === "pdf") return new TextDecoder("latin1").decode(data.subarray(0, 1024)).includes("%PDF-");
  if (kind === "docx") return hasPrefix(data, "PK");
  return !data.subarray(0, 4096).includes(0);
}

export async function pdfToText(data: Uint8Array): Promise<string> {
  const work = (async () => {
    const pdf = await getDocumentProxy(data);
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error("pdf too long");
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  })();
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("pdf timeout")), PDF_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function docxToText(data: Uint8Array): string {
  // Stream-inflate only word/document.xml and abort once real output passes the cap (zip bombs lie in headers).
  const chunks: Uint8Array[] = [];
  let total = 0;
  let found = false;
  let failure: Error | null = null;
  const uz = new Unzip((file) => {
    if (file.name !== "word/document.xml") return;
    found = true;
    file.ondata = (err, chunk) => {
      if (err) { failure = err; return; }
      if (failure) return;
      total += chunk.length;
      if (total > MAX_XML_BYTES) { failure = new Error("document too large"); file.terminate(); return; }
      chunks.push(chunk);
    };
    file.start();
  });
  uz.register(UnzipInflate);
  uz.push(data, true);
  if (failure) throw failure;
  if (!found) throw new Error("not a Word document");
  const xml = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { xml.set(c, o); o += c.length; }
  return docxXmlToText(new TextDecoder("utf-8").decode(xml));
}

export async function fileToText(kind: ReferenceKind, data: Uint8Array): Promise<string> {
  if (kind === "pdf") return pdfToText(data);
  if (kind === "docx") return docxToText(data);
  return new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
}
