import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDisplayName, isMissingDbError, nameOrDefault, parseStoredSummary } from "../src/lib/polishCore.ts";

test("missing table or column errors are recognised", () => {
  assert.equal(isMissingDbError({ code: "P2022" }), true);
  assert.equal(isMissingDbError({ code: "P2021" }), true);
  assert.equal(isMissingDbError({ code: "P2002" }), false);
  assert.equal(isMissingDbError(new Error("x")), false);
  assert.equal(isMissingDbError(null), false);
});

test("display name: trimmed, 40 chars, letters spaces and .-' only", () => {
  assert.deepEqual(cleanDisplayName("  Asha   Rao "), { ok: true, name: "Asha Rao" });
  assert.deepEqual(cleanDisplayName("Dr. O'Neil-Smith"), { ok: true, name: "Dr. O'Neil-Smith" });
  assert.deepEqual(cleanDisplayName("आशा"), { ok: true, name: "आशा" });
  assert.deepEqual(cleanDisplayName("   "), { ok: true, name: null });
  assert.equal(cleanDisplayName("a".repeat(41)).ok, false);
  assert.equal(cleanDisplayName("a".repeat(40)).ok, true);
  assert.equal(cleanDisplayName("Asha1").ok, false);
  assert.equal(cleanDisplayName("<b>x</b>").ok, false);
  assert.equal(cleanDisplayName("-Asha").ok, false);
  assert.equal(cleanDisplayName(5).ok, false);
});

test("name falls back to You", () => {
  assert.equal(nameOrDefault(null), "You");
  assert.equal(nameOrDefault("  "), "You");
  assert.equal(nameOrDefault("Asha"), "Asha");
});

test("stored summary parses, and bad data counts as none", () => {
  const s = { purpose: "p", keyPoints: ["a"], decisions: [], openQuestions: ["q"], tone: "t" };
  assert.deepEqual(parseStoredSummary(JSON.stringify(s)), s);
  assert.equal(parseStoredSummary(null), null);
  assert.equal(parseStoredSummary(""), null);
  assert.equal(parseStoredSummary("not json"), null);
  assert.equal(parseStoredSummary("[1]"), null);
  assert.deepEqual(parseStoredSummary('{"purpose":"x","keyPoints":[1,"b"]}')?.keyPoints, ["b"]);
});
