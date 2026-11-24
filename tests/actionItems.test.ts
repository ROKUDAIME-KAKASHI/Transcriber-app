import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SaveBody,
  buildActionItemsPrompt,
  chunkLines,
  mergeItems,
  parseActionItems,
  quoteInTranscript,
  verifyItems,
} from "../src/lib/actionItems.ts";

test("prompt contains the transcript literally", () => {
  const p = buildActionItemsPrompt("Asha: cost is $& 5 $1");
  assert.ok(p.endsWith("Transcript:\nAsha: cost is $& 5 $1"));
  assert.ok(p.includes("Return only JSON"));
  assert.ok(!p.includes("{{transcript}}"));
});

test("parses plain, fenced and prose-wrapped JSON", () => {
  const body =
    '{"action_items":[{"task":"Send the deck","owner":"Asha","deadline_text":"by Friday","source_quote":"I will send the deck by Friday"}]}';
  for (const text of [body, "```json\n" + body + "\n```", "Here you go:\n" + body + "\nThanks"]) {
    const items = parseActionItems(text);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      task: "Send the deck",
      owner: "Asha",
      deadlineText: "by Friday",
      sourceQuote: "I will send the deck by Friday",
    });
  }
});

test("garbage, empty and null-ish values", () => {
  assert.deepEqual(parseActionItems("sorry, no"), []);
  assert.deepEqual(parseActionItems('{"action_items": []}'), []);
  const items = parseActionItems(
    '{"action_items":[{"task":"Do it","owner":"null","deadline_text":"  ","source_quote":"x"},{"task":""},{"nope":1}]}'
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].owner, null);
  assert.equal(items[0].deadlineText, null);
});

test("caps at 50 items and clamps lengths", () => {
  const many = Array.from({ length: 80 }, (_, n) => ({ task: `t${n}`, source_quote: "q" }));
  assert.equal(parseActionItems(JSON.stringify({ action_items: many })).length, 50);
  const [i] = parseActionItems(JSON.stringify({ action_items: [{ task: "a".repeat(500), source_quote: "q" }] }));
  assert.equal(i.task.length, 300);
});

test("quote verification ignores case and whitespace", () => {
  const t = "Asha:  I will   send the deck\nby Friday.";
  assert.equal(quoteInTranscript("i will send the DECK by friday", t), true);
  assert.equal(quoteInTranscript("I will send the budget", t), false);
  assert.equal(quoteInTranscript("", t), false);
  const v = verifyItems(
    [
      { task: "a", owner: null, deadlineText: null, sourceQuote: "send the deck" },
      { task: "b", owner: null, deadlineText: null, sourceQuote: "invented" },
    ],
    t
  );
  assert.deepEqual(v.map((x) => x.verified), [true, false]);
});

test("chunkLines splits and reports truncation", () => {
  const lines = Array.from({ length: 10 }, () => "a b c d e");
  const r = chunkLines(lines, 20, 10);
  assert.equal(r.chunks.length, 3);
  assert.equal(r.truncated, false);
  const t = chunkLines(lines, 10, 2);
  assert.equal(t.chunks.length, 2);
  assert.equal(t.truncated, true);
});

test("mergeItems dedupes by task", () => {
  const a = { task: "Send deck", owner: null, deadlineText: null, sourceQuote: "q", verified: true };
  assert.equal(mergeItems([[a], [{ ...a, task: "send  DECK" }]]).length, 1);
});

test("SaveBody validates caps and nulls blanks", () => {
  const ok = SaveBody.safeParse({ items: [{ task: " x ", owner: " ", deadlineText: null, sourceQuote: "q" }] });
  assert.ok(ok.success);
  assert.equal(ok.data.items[0].task, "x");
  assert.equal(ok.data.items[0].owner, null);
  const bad = { owner: null, deadlineText: null, sourceQuote: "" };
  assert.ok(!SaveBody.safeParse({ items: [{ ...bad, task: "x".repeat(301) }] }).success);
  assert.ok(!SaveBody.safeParse({ items: [] }).success);
  assert.ok(!SaveBody.safeParse({ items: Array.from({ length: 101 }, () => ({ ...bad, task: "x" })) }).success);
});
