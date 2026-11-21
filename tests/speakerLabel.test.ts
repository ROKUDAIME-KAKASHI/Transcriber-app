import { test } from "node:test";
import assert from "node:assert/strict";
import { speakerLabel, transcriptToText } from "../src/lib/transcript.ts";

test("speakerLabel falls back to Speaker N", () => {
  assert.equal(speakerLabel(0), "Speaker 1");
  assert.equal(speakerLabel(1, null), "Speaker 2");
  assert.equal(speakerLabel(1, { "1": "   " }), "Speaker 2");
});

test("speakerLabel uses trimmed custom name", () => {
  assert.equal(speakerLabel(2, { "2": "Priya" }), "Priya");
  assert.equal(speakerLabel(0, { "0": "  Ravi " }), "Ravi");
});

test("single speaker has no labels", () => {
  const out = transcriptToText([{ speaker: 0, text: "a", t: 5 }, { speaker: 0, text: "b" }]);
  assert.equal(out, "[00:05] a\nb");
});

test("two speakers use names and blank-line join", () => {
  const out = transcriptToText(
    [{ speaker: 0, text: "hi", t: 5 }, { speaker: 1, text: "hello", t: 9 }],
    { names: { "1": "Priya" } }
  );
  assert.equal(out, "[00:05] Speaker 1: hi\n\n[00:09] Priya: hello");
});

test("multiSpeaker override labels a one-speaker chunk", () => {
  assert.equal(transcriptToText([{ speaker: 1, text: "x" }], { multiSpeaker: true }), "Speaker 2: x");
});
