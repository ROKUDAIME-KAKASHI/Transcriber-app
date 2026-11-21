import { test } from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, shouldReloadForChunkError, canApplyUpdate } from "../src/lib/sw/updateCore.ts";

test("ChunkLoadError by name", () => assert.equal(isChunkLoadError({ name: "ChunkLoadError", message: "x" }), true));
test("Failed to load chunk", () => assert.equal(isChunkLoadError(new Error("Failed to load chunk /_next/a.js")), true));
test("Loading chunk failed", () => assert.equal(isChunkLoadError(new Error("Loading chunk 12 failed.")), true));
test("dynamic import failure", () => assert.equal(isChunkLoadError(new Error("Failed to fetch dynamically imported module: x")), true));
test("unrelated / null / string", () => {
  assert.equal(isChunkLoadError(new Error("boom")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError("nope"), false);
});
test("recording -> notice", () => assert.deepEqual(shouldReloadForChunkError({ recording: true, lastReloadAt: null, now: 1 }), { action: "notice" }));
test("idle, never reloaded -> reload", () => assert.deepEqual(shouldReloadForChunkError({ recording: false, lastReloadAt: null, now: 1 }), { action: "reload" }));
test("idle within 60s -> none", () => assert.deepEqual(shouldReloadForChunkError({ recording: false, lastReloadAt: 1000, now: 60_999 }), { action: "none" }));
test("idle at exactly 60s -> reload", () => assert.deepEqual(shouldReloadForChunkError({ recording: false, lastReloadAt: 1000, now: 61_000 }), { action: "reload" }));
test("canApplyUpdate", () => {
  assert.equal(canApplyUpdate({ recording: false, hasWaiting: true, hasController: true }), true);
  assert.equal(canApplyUpdate({ recording: true, hasWaiting: true, hasController: true }), false);
  assert.equal(canApplyUpdate({ recording: false, hasWaiting: true, hasController: false }), false);
  assert.equal(canApplyUpdate({ recording: false, hasWaiting: false, hasController: true }), false);
});
