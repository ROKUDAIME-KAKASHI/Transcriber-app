import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, effectiveEngine } from "../src/lib/featureGateCore.ts";

for (const kind of ["deepgram", "ai"] as const) {
  test(`${kind}: needs-reauth disabled`, () => {
    assert.deepEqual(gate(kind, { conn: "online", auth: "needs-reauth" }), { enabled: false, reason: "Sign in again to use this" });
  });
  test(`${kind}: offline disabled`, () => {
    assert.deepEqual(gate(kind, { conn: "offline", auth: "app" }), { enabled: false, reason: "Needs internet" });
  });
  test(`${kind}: unknown and online enabled`, () => {
    assert.deepEqual(gate(kind, { conn: "unknown", auth: "app" }), { enabled: true, reason: null });
    assert.deepEqual(gate(kind, { conn: "online", auth: "app-cached" }), { enabled: true, reason: null });
  });
}

test("deepgram saved but disabled falls back to lastOnDevice", () => {
  assert.equal(effectiveEngine({ saved: "deepgram", lastOnDevice: "whisper", locked: false, deepgramEnabled: false }), "whisper");
});
test("fallback defaults to moonshine", () => {
  assert.equal(effectiveEngine({ saved: "deepgram", lastOnDevice: null, locked: false, deepgramEnabled: false }), "moonshine");
});
test("locked never switches", () => {
  assert.equal(effectiveEngine({ saved: "deepgram", lastOnDevice: "whisper", locked: true, deepgramEnabled: false }), "deepgram");
});
test("on-device and enabled deepgram pass through", () => {
  assert.equal(effectiveEngine({ saved: "whisper", lastOnDevice: null, locked: false, deepgramEnabled: false }), "whisper");
  assert.equal(effectiveEngine({ saved: "deepgram", lastOnDevice: "whisper", locked: false, deepgramEnabled: true }), "deepgram");
});
test("pure: saved value untouched", () => {
  const o = { saved: "deepgram", lastOnDevice: "whisper", locked: false, deepgramEnabled: false };
  effectiveEngine(o);
  assert.equal(o.saved, "deepgram");
});
