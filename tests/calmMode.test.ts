import { test } from "node:test";
import assert from "node:assert/strict";
import { calmMode, CALM_AFTER_SEC, CALM_BOOST_MS } from "../src/lib/calmMode.ts";

const base = { recording: true, paused: false, seconds: 5, reduced: false, hidden: false, lowBattery: false, boostUntil: 0, now: 1000 };

test("idle and reduced when not recording", () => {
  assert.equal(calmMode({ ...base, recording: false }), "idle");
  assert.equal(calmMode({ ...base, recording: false, reduced: true }), "reduced");
});
test("reduced wins while recording", () => {
  assert.equal(calmMode({ ...base, reduced: true, hidden: true, seconds: 9999 }), "reduced");
});
test("paused", () => assert.equal(calmMode({ ...base, paused: true }), "paused"));
test("hidden is calm", () => assert.equal(calmMode({ ...base, hidden: true }), "calm"));
test("calm after 10 minutes", () => {
  assert.equal(calmMode({ ...base, seconds: 599 }), "live");
  assert.equal(calmMode({ ...base, seconds: 600 }), "calm");
  assert.equal(CALM_AFTER_SEC, 600);
});
test("low battery is calm", () => assert.equal(calmMode({ ...base, lowBattery: true }), "calm"));
test("boost restores live until expiry", () => {
  assert.equal(calmMode({ ...base, seconds: 900, boostUntil: base.now + 1 }), "live");
  assert.equal(calmMode({ ...base, seconds: 900, boostUntil: base.now }), "calm");
  assert.equal(CALM_BOOST_MS, 60000);
});
test("hidden beats boost", () => {
  assert.equal(calmMode({ ...base, hidden: true, boostUntil: base.now + 5000 }), "calm");
});
