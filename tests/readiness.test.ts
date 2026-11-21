import { test } from "node:test";
import assert from "node:assert/strict";
import { chainFor, totalSizeMb, needsSpeakerDownload, labelSize, statusFrom, startGate } from "../src/lib/speech/readiness.ts";

test("chainFor moonshine-base includes tiny fallback", () => {
  assert.deepEqual(chainFor("moonshine", "moonshine-base"), ["moonshine-base", "moonshine-tiny"]);
});
test("chainFor moonshine-tiny is just tiny", () => {
  assert.deepEqual(chainFor("moonshine", "moonshine-tiny"), ["moonshine-tiny"]);
});
test("chainFor whisper", () => {
  assert.deepEqual(chainFor("whisper", "whisper-base"), ["whisper-base"]);
});
test("labels are honest", () => {
  assert.equal(labelSize(totalSizeMb(["moonshine-base", "moonshine-tiny"])), "about 110 MB");
  assert.equal(labelSize(totalSizeMb(["whisper-base"])), "about 90 MB");
  assert.equal(labelSize(totalSizeMb(["moonshine-tiny"])), "about 40 MB");
});
test("totalSizeMb can exclude the speaker model", () => {
  assert.equal(totalSizeMb(["moonshine-base", "moonshine-tiny"], { speaker: false }), 99);
});
test("needsSpeakerDownload only when ASR ready and speaker model missing", () => {
  assert.equal(needsSpeakerDownload({ status: "ready", speakerCached: false }), true);
  assert.equal(needsSpeakerDownload({ status: "ready", speakerCached: true }), false);
  for (const status of ["none", "partial", "downloading", "error"] as const) {
    assert.equal(needsSpeakerDownload({ status, speakerCached: false }), false);
  }
});
test("statusFrom ready needs all models and ORT", () => {
  assert.equal(statusFrom({ chainCached: [true, true], ortCached: true }), "ready");
  assert.equal(statusFrom({ chainCached: [true, true], ortCached: false }), "partial");
});
test("statusFrom partial and none", () => {
  assert.equal(statusFrom({ chainCached: [true, false], ortCached: true }), "partial");
  assert.equal(statusFrom({ chainCached: [false, false], ortCached: false }), "none");
});
test("statusFrom downloading and error override", () => {
  assert.equal(statusFrom({ chainCached: [true], ortCached: true, downloading: true }), "downloading");
  assert.equal(statusFrom({ chainCached: [true], ortCached: true, error: true }), "error");
});
test("startGate online is always allowed", () => {
  assert.equal(startGate({ preferredCached: false, ortCached: false, conn: "online" }).allowed, true);
  assert.equal(startGate({ preferredCached: false, ortCached: false, conn: "unknown" }).allowed, true);
});
test("startGate offline needs preferred and ORT", () => {
  assert.equal(startGate({ preferredCached: true, ortCached: true, conn: "offline" }).allowed, true);
  const g = startGate({ preferredCached: true, ortCached: false, conn: "offline" });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, "Not ready offline. Download needs internet.");
});
