import { test } from "node:test";
import assert from "node:assert/strict";
import { cropMiddle, embedDecision, cropSecFor, busyFraction } from "../src/lib/speech/embedSchedule.ts";

test("cropMiddle returns short input as-is", () => {
  const a = new Float32Array(1000);
  assert.equal(cropMiddle(a, 6), a);
});
test("cropMiddle takes a centred copy", () => {
  const a = new Float32Array(160000).map((_, i) => i);
  const c = cropMiddle(a, 6);
  assert.equal(c.length, 96000);
  assert.equal(c[0], 32000);
  assert.notEqual(c.buffer, a.buffer);
});
test("embedDecision order", () => {
  const ok = { seconds: 3, finalsWaiting: 0, speakerLoaded: true, slow: false };
  assert.equal(embedDecision(ok), "embed");
  assert.equal(embedDecision({ ...ok, seconds: 0.5, speakerLoaded: false }), "short");
  assert.equal(embedDecision({ ...ok, speakerLoaded: false, finalsWaiting: 5 }), "unavailable");
  assert.equal(embedDecision({ ...ok, finalsWaiting: 2, slow: true }), "backlog");
  assert.equal(embedDecision({ ...ok, slow: true }), "slow");
});
test("cropSecFor", () => {
  assert.equal(cropSecFor(null, false), 6);
  assert.equal(cropSecFor(900, false), 6);
  assert.equal(cropSecFor(1600, false), 3);
  assert.equal(cropSecFor(null, true), 3);
});
test("busyFraction clips to the window", () => {
  const now = 100000;
  // 40000..80000 (clipped from 30000) = 40000, 86000..100000 = 14000 -> 54000 / 60000
  assert.ok(Math.abs(busyFraction([[30000, 80000], [86000, 100000]], now) - 0.9) < 1e-9);
  assert.equal(busyFraction([[0, 30000]], now), 0);
  assert.ok(Math.abs(busyFraction([[30000, 50000]], now) - 10000 / 60000) < 1e-9);
});
