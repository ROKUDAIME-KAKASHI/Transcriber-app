import { test } from "node:test";
import assert from "node:assert/strict";
import { holdAppForRecording, nextRecorderOpts, recorderBusy, sameRecorderOpts } from "../src/lib/recorderOpts.ts";

const a = { engine: "moonshine", language: "en", deviceId: "", source: "mic", naming: undefined };

test("same options are detected, defaults normalised", () => {
  assert.equal(sameRecorderOpts(a, { ...a, deviceId: undefined, source: undefined }), true);
  assert.equal(sameRecorderOpts(a, { ...a, engine: "whisper" }), false);
  assert.equal(sameRecorderOpts(a, { ...a, naming: {} }), false);
});

test("options keep their identity when nothing changed (no provider re-render)", () => {
  assert.equal(nextRecorderOpts(a, { ...a }, false), a);
  const b = { ...a, language: "hi" };
  assert.equal(nextRecorderOpts(a, b, false), b);
});

test("options are frozen while recording", () => {
  assert.equal(nextRecorderOpts(a, { ...a, engine: "deepgram" }, true), a);
});

test("busy covers starting, recording and finishing", () => {
  assert.equal(recorderBusy({ isRecording: false, isStarting: false }), false);
  assert.equal(recorderBusy({ isRecording: true, isStarting: false }), true);
  assert.equal(recorderBusy({ isRecording: false, isStarting: true }), true);
  assert.equal(recorderBusy({ isRecording: false, isStarting: false, finishing: true }), true);
});

test("busy also covers the saving phase after Stop", () => {
  assert.equal(recorderBusy({ isRecording: false, isStarting: false, saveState: "saving" }), true);
  assert.equal(recorderBusy({ isRecording: false, isStarting: false, saveState: "saved" }), false);
  assert.equal(recorderBusy({ isRecording: false, isStarting: false, saveState: "local" }), false);
  assert.equal(recorderBusy({ isRecording: false, isStarting: false, saveState: "idle" }), false);
});

test("the app is held for a busy recording on any non-app auth decision", () => {
  assert.equal(holdAppForRecording("redirect-login", true), true);
  assert.equal(holdAppForRecording("needs-internet", true), true);
  assert.equal(holdAppForRecording("pending", true), true);
  assert.equal(holdAppForRecording("redirect-login", false), false);
  assert.equal(holdAppForRecording("app", true), false);
  assert.equal(holdAppForRecording("app-cached", true), false);
});
