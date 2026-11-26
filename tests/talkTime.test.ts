import { test } from "node:test";
import assert from "node:assert/strict";
import { talkTime } from "../src/lib/talkTime.ts";

const words = (n: number) => Array.from({ length: n }, () => "w").join(" ");

test("shares use the gap to the next phrase, capped by the words said", () => {
  const r = talkTime([
    { speaker: 0, text: words(25), t: 0 }, // est 10 s, gap 10 s -> 10
    { speaker: 1, text: words(5), t: 10 }, // est 2 s, gap 60 s (silence) -> capped at 4
    { speaker: 0, text: words(10), t: 70 }, // last: est 4 s
  ]);
  assert.deepEqual(
    r.map((x) => [x.speaker, Math.round(x.seconds)]),
    [
      [0, 14],
      [1, 4],
    ]
  );
  assert.ok(Math.abs(r.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(r[0].share - 14 / 18) < 1e-9);
});

test("without times it falls back to word counts", () => {
  const r = talkTime([
    { speaker: 2, text: words(30) },
    { speaker: 0, text: words(10) },
  ]);
  assert.equal(r[0].speaker, 2);
  assert.ok(Math.abs(r[0].share - 0.75) < 1e-9);
});

test("empty transcript gives no shares", () => {
  assert.deepEqual(talkTime([]), []);
});
