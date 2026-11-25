import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_MIN_WORDS, STALE_RUNNING_MS, addSample, claim, enqueue, entryFor, estimateSeconds, etaLabel, parseSamples, queuedIds,
  settle, shouldRunNow, type KV,
} from "../src/lib/autoMinutesCore.ts";

function mem(): KV & { raw: string | null } {
  const kv = {
    raw: null as string | null,
    get() {
      return kv.raw;
    },
    set(v: string) {
      kv.raw = v;
    },
  };
  return kv;
}

test("estimate: default grows with length and is clamped", () => {
  assert.equal(estimateSeconds(0, []), 10);
  assert.ok(estimateSeconds(3000, []) > estimateSeconds(300, []));
  assert.equal(estimateSeconds(10_000_000, []), 240);
});

test("estimate: uses the rolling average of past runs", () => {
  const samples = [{ words: 1000, secs: 40 }, { words: 1000, secs: 40 }];
  const same = estimateSeconds(1000, samples);
  assert.ok(Math.abs(same - 40) <= 1, `got ${same}`);
  assert.ok(estimateSeconds(2000, samples) > same);
  assert.ok(estimateSeconds(200, samples) < same);
});

test("samples: keep only the last five, ignore bad ones", () => {
  let s: ReturnType<typeof addSample> = [];
  for (let i = 1; i <= 8; i++) s = addSample(s, { words: 100 * i, secs: i });
  assert.equal(s.length, 5);
  assert.equal(s[0].words, 400);
  assert.deepEqual(addSample(s, { words: 0, secs: 5 }), s);
  assert.deepEqual(parseSamples("not json"), []);
  assert.deepEqual(parseSamples('[{"words":1,"secs":2},{"x":1}]'), [{ words: 1, secs: 2 }]);
});

test("etaLabel wording", () => {
  assert.equal(etaLabel(20), "about 20 seconds");
  assert.equal(etaLabel(3), "about 5 seconds");
  assert.equal(etaLabel(100), "about 2 minutes");
});

test("enqueue: too short is ignored, and only once", () => {
  const kv = mem();
  assert.equal(enqueue(kv, "m1", AUTO_MIN_WORDS - 1, 1000), false);
  assert.equal(enqueue(kv, "m1", 200, 1000), true);
  assert.equal(enqueue(kv, "m1", 200, 2000), false);
});

test("claim: exactly one winner, then nobody until it is stale", () => {
  const kv = mem();
  enqueue(kv, "m1", 200, 1000);
  assert.equal(claim(kv, "m1", 1000, "a"), true);
  assert.equal(claim(kv, "m1", 1001, "b"), false);
  assert.equal(claim(kv, "m1", 1000 + STALE_RUNNING_MS + 1, "c"), true);
  assert.equal(claim(kv, "unknown", 1000, "a"), false);
});

test("claim: a tab that lost the race to the write sees false", () => {
  const kv = mem();
  enqueue(kv, "m1", 200, 1000);
  const realSet = kv.set;
  // Another tab writes its token right after ours.
  kv.set = (v: string) => {
    realSet(v);
    const book = JSON.parse(v);
    book.m1.token = "other";
    realSet(JSON.stringify(book));
  };
  assert.equal(claim(kv, "m1", 1000, "me"), false);
});

test("settle: done and failed are never claimed again; queued can be", () => {
  const kv = mem();
  enqueue(kv, "m1", 200, 1000);
  claim(kv, "m1", 1000, "a");
  settle(kv, "m1", "done", 1100);
  assert.equal(claim(kv, "m1", 1200, "b"), false);
  assert.equal(enqueue(kv, "m1", 200, 1300), false);
  enqueue(kv, "m2", 200, 1000);
  claim(kv, "m2", 1000, "a");
  settle(kv, "m2", "failed", 1100);
  assert.equal(claim(kv, "m2", 1200, "b"), false);
  enqueue(kv, "m3", 200, 1000);
  claim(kv, "m3", 1000, "a");
  settle(kv, "m3", "queued", 1100);
  assert.deepEqual(queuedIds(kv, 1200), ["m3"]);
  assert.equal(claim(kv, "m3", 1200, "b"), true);
  assert.equal(entryFor(kv, "m3", 1200)?.state, "running");
});

test("old entries are dropped; garbage storage is tolerated", () => {
  const kv = mem();
  enqueue(kv, "m1", 200, 1000);
  assert.equal(entryFor(kv, "m1", 1000 + 15 * 24 * 3600_000), null);
  kv.raw = "{{{";
  assert.deepEqual(queuedIds(kv, 5), []);
  assert.equal(enqueue(kv, "m9", 100, 5), true);
});

test("shouldRunNow needs flag, online, signed in and not recording", () => {
  const ok = { flagOn: true, online: true, signedIn: true, recording: false };
  assert.equal(shouldRunNow(ok), true);
  for (const k of ["flagOn", "online", "signedIn"] as const) assert.equal(shouldRunNow({ ...ok, [k]: false }), false);
  assert.equal(shouldRunNow({ ...ok, recording: true }), false);
});
