import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  followAfterScroll,
  inputStatusLines,
  isNearBottom,
  recordControlState,
  showJumpToLatest,
  type RecordControlInput,
} from "../src/lib/recordControl.ts";

const base: RecordControlInput = {
  busy: false, paused: false, starting: false, finishing: false,
  saveState: "idle", meetingId: null, hasTranscript: false, statusMsg: "Ready",
};
const st = (o: Partial<RecordControlInput>) => recordControlState({ ...base, ...o });

describe("recordControlState", () => {
  test("idle is ready", () => assert.equal(st({}), "ready"));
  test("starting wins", () => assert.equal(st({ starting: true, statusMsg: "Loading speech model…" }), "starting"));
  test("recording and paused", () => {
    assert.equal(st({ busy: true }), "recording");
    assert.equal(st({ busy: true, paused: true }), "paused");
  });
  test("stopping shows saving", () => {
    assert.equal(st({ saveState: "saving", meetingId: "m1", statusMsg: "Stopped. Saving…" }), "saving");
    assert.equal(st({ finishing: true, saveState: "local", meetingId: "m1", hasTranscript: true }), "saving");
  });
  test("saved once the meeting is in", () => {
    assert.equal(st({ saveState: "saved", meetingId: "m1", hasTranscript: true, statusMsg: "Saved to your account." }), "saved");
    assert.equal(st({ saveState: "local", meetingId: "m1", hasTranscript: true }), "saved");
  });
  test("a start failure is an error", () => {
    assert.equal(st({ statusMsg: "Microphone access was blocked." }), "error");
  });
  test("cancelled is not an error", () => assert.equal(st({ statusMsg: "Cancelled." }), "ready"));
  test("a meeting with no transcript is not saved", () => {
    assert.equal(st({ saveState: "local", meetingId: "m1", hasTranscript: false }), "ready");
  });
});

describe("inputStatusLines", () => {
  test("default mic, recording, sound toggle", () => {
    assert.deepEqual(
      inputStatusLines({ state: "recording", micLabel: "", phoneMic: false, soundToggle: true, soundOn: false }),
      ["Microphone: Default · active", "Computer sound: off"],
    );
  });
  test("named mic, no toggle", () => {
    assert.deepEqual(
      inputStatusLines({ state: "ready", micLabel: "USB Mic", phoneMic: false, soundToggle: false, soundOn: false }),
      ["Microphone: USB Mic · ready"],
    );
  });
  test("phone mic paused", () => {
    assert.deepEqual(
      inputStatusLines({ state: "paused", micLabel: "x", phoneMic: true, soundToggle: false, soundOn: false }),
      ["Microphone: Phone microphone · paused"],
    );
  });
});

describe("auto-follow", () => {
  test("near bottom", () => {
    assert.equal(isNearBottom({ scrollTop: 952, clientHeight: 400, scrollHeight: 1400 }), true);
    assert.equal(isNearBottom({ scrollTop: 500, clientHeight: 400, scrollHeight: 1400 }), false);
  });
  test("user scrolling up stops following", () => assert.equal(followAfterScroll(true, false, true), false));
  test("programmatic scroll keeps the previous state", () => {
    assert.equal(followAfterScroll(true, false, false), true);
    assert.equal(followAfterScroll(false, false, false), false);
  });
  test("reaching the bottom resumes following", () => assert.equal(followAfterScroll(false, true, false), true));
  test("jump button only while recording and not following", () => {
    assert.equal(showJumpToLatest(true, false), true);
    assert.equal(showJumpToLatest(true, true), false);
    assert.equal(showJumpToLatest(false, false), false);
  });
});
