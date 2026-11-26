import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightSegments, matchesQuery } from "../src/lib/transcriptSearch.ts";

test("matching ignores case and surrounding spaces; empty matches all", () => {
  assert.equal(matchesQuery("We agreed on the BUDGET", "  budget "), true);
  assert.equal(matchesQuery("We agreed", "budget"), false);
  assert.equal(matchesQuery("anything", ""), true);
  assert.equal(matchesQuery("anything", "   "), true);
});

test("highlight pieces rebuild the text and flag every hit", () => {
  const text = "Budget talk: the budget is fine";
  const segs = highlightSegments(text, "budget");
  assert.equal(segs.map((s) => s.text).join(""), text);
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ["Budget", "budget"]);
});

test("no query or no hit gives one plain piece", () => {
  assert.deepEqual(highlightSegments("hello", ""), [{ text: "hello", hit: false }]);
  assert.deepEqual(highlightSegments("hello", "zzz"), [{ text: "hello", hit: false }]);
});

test("Hindi text is searched too", () => {
  const segs = highlightSegments("बजट पर चर्चा हुई", "बजट");
  assert.deepEqual(segs[0], { text: "बजट", hit: true });
});
