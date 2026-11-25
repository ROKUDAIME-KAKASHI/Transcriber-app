import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DUCK_CONFIG, DUCK_GAIN, initialDuck, stepDuck } from "../src/lib/callDuck.ts";

const LOUD = DUCK_CONFIG.threshold * 2;
const QUIET = DUCK_CONFIG.threshold / 10;

describe("mic ducking", () => {
  test("starts not ducked and stays so while the call is quiet", () => {
    let s = initialDuck();
    for (let t = 0; t < 1000; t += 50) s = stepDuck(s, QUIET, t);
    assert.equal(s.ducked, false);
  });
  test("ducks as soon as the call is above the threshold", () => {
    assert.equal(stepDuck(initialDuck(), LOUD, 0).ducked, true);
  });
  test("exactly at the threshold counts as speech", () => {
    assert.equal(stepDuck(initialDuck(), DUCK_CONFIG.threshold, 0).ducked, true);
  });
  test("holds for the hold time after the call goes quiet, then releases", () => {
    let s = stepDuck(initialDuck(), LOUD, 1000);
    s = stepDuck(s, QUIET, 1000 + DUCK_CONFIG.holdMs - 50);
    assert.equal(s.ducked, true);
    s = stepDuck(s, QUIET, 1000 + DUCK_CONFIG.holdMs);
    assert.equal(s.ducked, true);
    s = stepDuck(s, QUIET, 1000 + DUCK_CONFIG.holdMs + 50);
    assert.equal(s.ducked, false);
  });
  test("new speech during the hold restarts it", () => {
    let s = stepDuck(initialDuck(), LOUD, 0);
    s = stepDuck(s, LOUD, 250);
    s = stepDuck(s, QUIET, 250 + DUCK_CONFIG.holdMs - 10);
    assert.equal(s.ducked, true);
  });
  test("unchanged state is returned as is (no needless work)", () => {
    const s = initialDuck();
    assert.equal(stepDuck(s, QUIET, 100), s);
  });
  test("custom config is respected", () => {
    const cfg = { threshold: 0.2, holdMs: 100 };
    assert.equal(stepDuck(initialDuck(), 0.1, 0, cfg).ducked, false);
    assert.equal(stepDuck(initialDuck(), 0.3, 0, cfg).ducked, true);
  });
  test("ducked gain is about -20 dB", () => {
    assert.ok(Math.abs(20 * Math.log10(DUCK_GAIN) + 20) < 0.5);
  });
});
