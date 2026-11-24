import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNameExcerpt,
  detectSelfIntroductions,
  dismissKey,
  mergeSuggestions,
  parseAiNames,
  transcriptFingerprint,
  validateAiSuggestions,
  type NameSuggestion,
} from "../src/lib/nameDetect.ts";

const other = { speaker: 1, text: "Okay, let's get started.", t: 5 };
function one(text: string, t = 10) {
  return detectSelfIntroductions([{ speaker: 0, text, t }, other]);
}

test("positive self-introductions", () => {
  const cases: Array<[string, string]> = [
    ["Hi, I'm Priya from the sales team.", "Priya"],
    ["My name is Rahul Sharma and I lead design.", "Rahul Sharma"],
    ["This is Anil from sales.", "Anil"],
    ["Okay, Anil here.", "Anil"],
    ["Hi Priya here, can you hear me?", "Priya"],
    ["mera naam rohit hai", "Rohit"],
    ["main suresh bol raha hoon", "Suresh"],
    ["मेरा नाम प्रिया है", "प्रिया"],
    ["मैं राहुल बोल रहा हूँ", "राहुल"],
  ];
  for (const [text, name] of cases) {
    const r = one(text);
    assert.equal(r.length, 1, text);
    assert.equal(r[0].name, name, text);
    assert.equal(r[0].speaker, 0);
    assert.equal(r[0].source, "device");
  }
});

test("negative phrases give nothing", () => {
  const bad = [
    "I'm sure that works.", "I'm Going to share my screen.", "I am Not sure", "I'm Sorry", "I am In the office",
    "I am Sharing now", "main bhi hoon", "मैं ठीक हूँ", "this is it.", "This is Important.", "main ready hoon",
  ];
  for (const text of bad) assert.deepEqual(one(text), [], text);
});

test("single speaker, or already named speaker, gives nothing", () => {
  assert.deepEqual(detectSelfIntroductions([{ speaker: 0, text: "My name is Rahul.", t: 1 }]), []);
  const parts = [{ speaker: 0, text: "My name is Rahul.", t: 1 }, other];
  assert.deepEqual(detectSelfIntroductions(parts, { names: { "0": "Boss" } }), []);
});

test("same name for two speakers: higher score wins, tie drops both", () => {
  const hi = detectSelfIntroductions([
    { speaker: 0, text: "My name is Priya.", t: 1 },
    { speaker: 1, text: "I'm Priya.", t: 2 },
  ]);
  assert.deepEqual(hi.map((s) => s.speaker), [0]);
  const tie = detectSelfIntroductions([
    { speaker: 0, text: "My name is Priya.", t: 1 },
    { speaker: 1, text: "My name is Priya.", t: 2 },
  ]);
  assert.deepEqual(tie, []);
});

test("time weighting and confidence", () => {
  assert.equal(one("I'm Priya.", 3000).length, 0);
  const early = one("I'm Priya.", 20);
  assert.equal(early[0].confidence, "medium");
  assert.equal(one("My name is Priya.", 20)[0].confidence, "high");
});

test("addressing someone by name blocks that name for the speaker", () => {
  const r = detectSelfIntroductions([
    { speaker: 0, text: "Thanks Priya for joining.", t: 1 },
    { speaker: 0, text: "I'm Priya.", t: 2 },
    other,
  ]);
  assert.deepEqual(r, []);
});

test("another speaker's custom name is not suggested", () => {
  const parts = [{ speaker: 0, text: "My name is Priya.", t: 1 }, other];
  assert.deepEqual(detectSelfIntroductions(parts, { names: { "1": "priya" } }), []);
});

test("digits rejected, name capped", () => {
  assert.deepEqual(one("My name is Agent007"), []);
  const r = one("My name is Abcdefghijklmnopqrstuvwxy Abcdefghijklmnopqrstuvwxy");
  assert.ok(r.length === 0 || r[0].name.length <= 40);
});

test("5000 filler parts are fast", () => {
  const parts = Array.from({ length: 5000 }, (_, i) => ({ speaker: i % 2, text: "We should review the quarterly numbers now.", t: i }));
  const t0 = performance.now();
  detectSelfIntroductions(parts);
  assert.ok(performance.now() - t0 < 200);
});

const lines = [
  { s: 0, t: 5, text: "Hi, I'm Priya from sales" },
  { s: 1, t: 9, text: "Thanks Rahul, go ahead" },
];

test("validateAiSuggestions", () => {
  const raw = [
    { speaker: 1, name: "Priya", evidence: "Hi, I'm Priya from sales", confidence: "high" },
    { speaker: 9, name: "Priya", evidence: "Hi, I'm Priya from sales" },
    { speaker: 2, name: "Rahul", evidence: "Thanks Rahul, go ahead" },
    { speaker: 2, name: "Amit", evidence: "Thanks Rahul, go ahead" },
    { speaker: 2, name: "Rahul", evidence: "Something never said" },
    { speaker: 1, name: "Priya", evidence: "Hi, I'm Priya" },
  ];
  const r = validateAiSuggestions(raw, lines);
  assert.deepEqual(r.map((s) => [s.speaker, s.name, s.source]), [[0, "Priya", "ai"], [1, "Rahul", "ai"]]);
  assert.equal(r[0].t, 5);
  assert.deepEqual(validateAiSuggestions(raw, lines, { "0": "X" }).map((s) => s.speaker), [1]);
});

test("parseAiNames is lenient", () => {
  assert.deepEqual(parseAiNames("```json\n{\"suggestions\":[{\"a\":1}]}\n```"), [{ a: 1 }]);
  assert.deepEqual(parseAiNames("nope"), []);
  assert.deepEqual(parseAiNames("{bad json}"), []);
});

test("buildNameExcerpt keeps early lines and later cue lines, within caps", () => {
  const parts = Array.from({ length: 300 }, (_, i) => ({ speaker: i % 2, text: `filler line number ${i}`, t: i * 10 }));
  parts[200] = { speaker: 1, text: "Hello, I'm Dev here", t: 2000 };
  const ex = buildNameExcerpt(parts);
  assert.ok(ex.some((l) => l.text.includes("Dev")));
  assert.ok(ex.some((l) => l.t === 0));
  assert.ok(ex.length < 150);
  assert.ok(ex.every((l, i) => i === 0 || (l.t ?? 0) >= (ex[i - 1].t ?? 0)));
  assert.ok(buildNameExcerpt(parts, { maxChars: 500 }).reduce((n, l) => n + l.text.length, 0) <= 500);
});

const sug = (speaker: number, name: string, source: "device" | "ai", confidence: "high" | "medium" = "medium"): NameSuggestion =>
  ({ speaker, name, source, confidence, evidence: "e" });

test("mergeSuggestions", () => {
  const m = mergeSuggestions([sug(0, "Priya", "device")], [sug(0, "priya", "ai"), sug(1, "Rahul", "ai")]);
  assert.deepEqual(m.map((s) => [s.speaker, s.name, s.confidence]), [[0, "Priya", "high"], [1, "Rahul", "medium"]]);
  const disagree = mergeSuggestions([sug(0, "Priya", "device")], [sug(0, "Anita", "ai")]);
  assert.equal(disagree[0].name, "Priya");
  const hidden = mergeSuggestions([sug(0, "Priya", "device")], [], { dismissed: [dismissKey(0, "PRIYA")] });
  assert.deepEqual(hidden, []);
  assert.deepEqual(mergeSuggestions([sug(0, "Priya", "device")], [], { names: { "0": "Boss" } }), []);
});

test("transcriptFingerprint", () => {
  assert.equal(transcriptFingerprint([{ speaker: 0, text: "a", t: 4.7 }, { speaker: 1, text: "b", t: 9.2 }]), "2:2:9");
});
