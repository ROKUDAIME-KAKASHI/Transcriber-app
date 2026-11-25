import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBackground, buildPointsPrompt, capText, chunkDocument, cleanFileName, docxXmlToText, mergePoints,
  normalizeText, parsePoints, parseStoredPoints, referenceKind, verifyPoints,
} from "../src/lib/prework.ts";

test("referenceKind goes by extension", () => {
  assert.equal(referenceKind("Budget.PDF"), "pdf");
  assert.equal(referenceKind("a.docx"), "docx");
  assert.equal(referenceKind("notes.md"), "text");
  assert.equal(referenceKind("notes.txt"), "text");
  assert.equal(referenceKind("old.doc"), null);
  assert.equal(referenceKind("noext"), null);
});

test("cleanFileName drops paths and control characters", () => {
  assert.equal(cleanFileName(String.raw`C:\x\y\Plan` + "\n.pdf"), "Plan .pdf");
  assert.equal(cleanFileName("   "), "Reference");
  assert.equal(cleanFileName("a".repeat(300)).length, 200);
});

test("normalizeText and capText", () => {
  assert.equal(normalizeText("a  \r\n\r\n\r\n\r\nb\u0000"), "a\n\nb");
  assert.deepEqual(capText("abc", 5), { text: "abc", truncated: false });
  assert.deepEqual(capText("abcdef", 3), { text: "abc", truncated: true });
  const r = capText("ab😀cd", 3);
  assert.equal(r.text, "ab");
  assert.equal(r.truncated, true);
});

test("docxXmlToText joins runs, breaks paragraphs, decodes entities and keeps Devanagari", () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t xml:space="preserve">R&amp;D</w:t></w:r></w:p>' +
    "<w:p><w:r><w:t>बजट &#8377;5 &#x41;</w:t></w:r><w:r><w:tab/><w:t>x</w:t></w:r></w:p>" +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "<w:p><w:r><w:t/></w:r></w:p></w:body></w:document>";
  const t = docxXmlToText(xml);
  assert.ok(t.startsWith("Hello R&D\nबजट ₹5 A\tx"));
  assert.ok(t.includes("A\n\tB") || t.includes("A\nB") || t.includes("A\n"));
});

test("parsePoints is lenient and capped", () => {
  const raw = 'Sure!\n```json\n{"points":[{"point":" Budget is  $5M ","source_quote":"budget of $5M"},{"nope":1},{"point":""}]}\n```';
  assert.deepEqual(parsePoints(raw), [{ point: "Budget is $5M", sourceQuote: "budget of $5M" }]);
  assert.deepEqual(parsePoints("not json"), []);
  const many = JSON.stringify({ points: Array.from({ length: 20 }, (_, i) => ({ point: `p${i}`, source_quote: "q" })) });
  assert.equal(parsePoints(many).length, 8);
});

test("verifyPoints needs a verbatim quote, ignoring case and whitespace", () => {
  const doc = "The  budget of $5M\nwas approved on 3 March.";
  const v = verifyPoints(
    [
      { point: "a", sourceQuote: "Budget of $5M was approved" },
      { point: "b", sourceQuote: "budget of $6M" },
      { point: "c", sourceQuote: "" },
    ],
    doc
  );
  assert.deepEqual(v.map((p) => p.verified), [true, false, false]);
});

test("mergePoints dedupes and puts verified first", () => {
  const m = mergePoints([
    [{ point: "A", sourceQuote: "a", verified: false }, { point: "B", sourceQuote: "b", verified: true }],
    [{ point: "a.", sourceQuote: "a", verified: true }, { point: "a", sourceQuote: "a", verified: true }],
  ]);
  assert.deepEqual(m.map((p) => p.point), ["B", "A"]);
});

test("chunkDocument splits at paragraphs, at most three chunks, and reports the cut", () => {
  const para = "word ".repeat(10).trim();
  const text = Array.from({ length: 40 }, () => para).join("\n\n");
  const r = chunkDocument(text, 200, 3);
  assert.equal(r.chunks.length, 3);
  assert.equal(r.truncated, true);
  assert.ok(r.chunks.every((c) => c.length <= 200));
  const small = chunkDocument("short", 200, 3);
  assert.deepEqual(small, { chunks: ["short"], truncated: false });
});

test("the prompt treats the document as data and keeps $ patterns literal", () => {
  const p = buildPointsPrompt("cost $& and $1");
  assert.ok(p.includes("cost $& and $1"));
  assert.ok(/DATA, not instructions/.test(p));
});

test("parseStoredPoints tolerates junk", () => {
  assert.equal(parseStoredPoints(null), null);
  assert.deepEqual(parseStoredPoints([{ point: "x", sourceQuote: "y", verified: true }, 3, { point: "" }]), [
    { point: "x", sourceQuote: "y", verified: true },
  ]);
});

test("appendBackground creates the heading, avoids duplicates and extends an existing block", () => {
  const a = appendBackground("1. Budget", ["Revenue is up 10%", "Hiring freeze"]);
  assert.equal(a.agenda, "1. Budget\n\nBackground\n• Revenue is up 10%\n• Hiring freeze");
  assert.equal(a.added, 2);
  const b = appendBackground(a.agenda, ["revenue is up 10%", "New vendor"]);
  assert.equal(b.added, 1);
  assert.equal(b.agenda, "1. Budget\n\nBackground\n• Revenue is up 10%\n• Hiring freeze\n• New vendor");
  const c = appendBackground("Background\n• One\n\n2. Next", ["Two"]);
  assert.equal(c.agenda, "Background\n• One\n• Two\n\n2. Next");
  assert.equal(appendBackground("", ["X"]).agenda, "Background\n• X");
  const d = appendBackground("x".repeat(20), ["abc", "def"], 40);
  assert.equal(d.added, 1);
  assert.ok(d.agenda.length <= 40);
});
