import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_RECORDING_MS,
  canStopFromList,
  isStaleRecording,
  isStoppedReply,
  lastActivityMs,
  stopConfirmText,
} from "../src/lib/recordingState.ts";

const NOW = Date.parse("2026-11-23T10:00:00Z");

describe("isStaleRecording", () => {
  test("fresh server update is not stale", () => {
    const r = { status: "RECORDING", serverUpdatedAt: new Date(NOW - 30_000).toISOString() };
    assert.equal(isStaleRecording(r, NOW), false);
  });
  test("older than 2 minutes is stale", () => {
    const r = { status: "RECORDING", serverUpdatedAt: new Date(NOW - STALE_RECORDING_MS - 1000).toISOString() };
    assert.equal(isStaleRecording(r, NOW), true);
  });
  test("newest of local write and server update counts", () => {
    const r = { status: "RECORDING", lastWriteAt: NOW - 5000, serverUpdatedAt: new Date(NOW - 600_000).toISOString() };
    assert.equal(isStaleRecording(r, NOW), false);
    assert.equal(lastActivityMs(r), NOW - 5000);
  });
  test("finished meetings are never stale", () => {
    assert.equal(isStaleRecording({ status: "DONE", serverUpdatedAt: "2020-01-01T00:00:00Z" }, NOW), false);
  });
  test("falls back to createdAt, and unknown times are not stale", () => {
    assert.equal(isStaleRecording({ status: "RECORDING", createdAt: new Date(NOW - 600_000).toISOString() }, NOW), true);
    assert.equal(isStaleRecording({ status: "RECORDING" }, NOW), false);
  });
});

describe("canStopFromList", () => {
  test("other device: always", () => {
    assert.equal(canStopFromList({ status: "RECORDING", origin: "server", activeHere: false, stale: false }), true);
  });
  test("live web recorder here: no", () => {
    assert.equal(canStopFromList({ status: "RECORDING", origin: "local", activeHere: true, stale: false }), false);
  });
  test("leftover web recording here: yes", () => {
    assert.equal(canStopFromList({ status: "RECORDING", origin: "local", activeHere: false, stale: false }), true);
  });
  test("native here: only when stale", () => {
    assert.equal(canStopFromList({ status: "RECORDING", origin: "native", activeHere: false, stale: false }), false);
    assert.equal(canStopFromList({ status: "RECORDING", origin: "native", activeHere: false, stale: true }), true);
  });
  test("done: no", () => {
    assert.equal(canStopFromList({ status: "DONE", origin: "server", activeHere: false, stale: true }), false);
  });
});

describe("isStoppedReply / stopConfirmText", () => {
  test("detects stopped replies", () => {
    assert.equal(isStoppedReply({ ok: true, stopped: true }), true);
    assert.equal(isStoppedReply({ ok: true, status: "DONE" }), true);
    assert.equal(isStoppedReply({ ok: true, savedParts: 3 }), false);
    assert.equal(isStoppedReply(null), false);
  });
  test("confirm text names the device", () => {
    assert.match(stopConfirmText("Pixel 8"), /Stop the recording on Pixel 8\?/);
    assert.match(stopConfirmText(null), /other device/);
  });
});
