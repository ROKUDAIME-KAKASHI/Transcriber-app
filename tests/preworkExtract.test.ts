import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { docxToText, sniffMatches, MAX_XML_BYTES } from "../src/lib/preworkExtract.ts";

const zip = (xml: Uint8Array) => zipSync({ "word/document.xml": xml });

test("docxToText reads text from document.xml", () => {
  const xml = strToU8('<w:document><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:document>');
  assert.equal(docxToText(zip(xml)), "Hello");
});

test("docxToText aborts a decompression bomb", () => {
  const big = new Uint8Array(MAX_XML_BYTES + 1024);
  assert.throws(() => docxToText(zip(big)));
});

test("docxToText rejects a zip without document.xml", () => {
  assert.throws(() => docxToText(zipSync({ "a.txt": strToU8("x") })));
});

test("sniffMatches checks magic bytes", () => {
  assert.ok(sniffMatches("pdf", strToU8("%PDF-1.7 x")));
  assert.ok(!sniffMatches("pdf", strToU8("hello")));
  assert.ok(sniffMatches("docx", strToU8("PK\u0003\u0004")));
  assert.ok(!sniffMatches("docx", strToU8("MZ")));
  assert.ok(!sniffMatches("text", new Uint8Array([65, 0, 66])));
});
