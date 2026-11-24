import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECORDING_ON_PHONE_MSG,
  finishingLine,
  nativeStatusLine,
  pickCapture,
  resumeFrom,
  type CaptureInfoLite,
} from "../src/lib/speech/nativeSession.ts";

const cap = (over: Partial<CaptureInfoLite>): CaptureInfoLite => ({
  meetingId: "m1", head: 1000, committed: 0, state: "recording", active: true, engine: "moonshine", language: "en", startedAt: 1, ...over,
});

test("status line: paused, catching up, or the normal recording message", () => {
  assert.match(nativeStatusLine({ paused: true, behindSamples: 0 }), /^Paused/);
  assert.equal(nativeStatusLine({ paused: false, behindSamples: 16000 }), RECORDING_ON_PHONE_MSG);
  assert.match(nativeStatusLine({ paused: false, behindSamples: 16000 * 600 }), /^Catching up · 10 min of audio left/);
  assert.match(nativeStatusLine({ paused: false, behindSamples: 16000 * 600, rate: 2 }), /about 5 min/);
});

test("finishing line reports what is left, with an estimate when the rate is known", () => {
  assert.equal(finishingLine(0), "Finishing transcription…");
  assert.equal(finishingLine(16000 * 120), "Finishing transcription. 2 min of audio left.");
  assert.match(finishingLine(16000 * 600, 1), /10 min of audio left \(about 10 min\)/);
});

test("pickCapture re-attaches to the live capture of this user's flagged meetings only", () => {
  const rows = new Map([
    ["m1", { nativeCapture: 1 as const, status: "RECORDING" }],
    ["m2", { nativeCapture: 0 as const, status: "DONE" }],
  ]);
  const caps = [cap({ meetingId: "m1" }), cap({ meetingId: "m2", active: false, state: "stopped" }), cap({ meetingId: "other", active: false, state: "interrupted" })];
  const { live, unfinished } = pickCapture(caps, rows);
  assert.equal(live?.meetingId, "m1");
  assert.deepEqual(unfinished, []); // m2 is finished, "other" has no row here and is never touched
});

test("pickCapture lists stopped/interrupted flagged captures oldest first", () => {
  const rows = new Map([
    ["a", { nativeCapture: 1 as const, status: "RECORDING" }],
    ["b", { nativeCapture: 1 as const, status: "RECORDING" }],
  ]);
  const { live, unfinished } = pickCapture(
    [cap({ meetingId: "b", active: false, state: "interrupted", startedAt: 20 }), cap({ meetingId: "a", active: false, state: "stopped", startedAt: 10 })],
    rows,
  );
  assert.equal(live, null);
  assert.deepEqual(unfinished.map((c) => c.meetingId), ["a", "b"]);
});

test("resumeFrom never reads behind what the phone already released", () => {
  assert.equal(resumeFrom({ nativeCursor: 500, status: "RECORDING" }, { committed: 0 }), 500);
  assert.equal(resumeFrom({ nativeCursor: 500, status: "RECORDING" }, { committed: 900 }), 900);
  assert.equal(resumeFrom(undefined, { committed: 0 }), 0);
});
