import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CALL_SILENCE, detectCallPlatform, initialSilence, openableCallUrl, rmsOf, stepSilence,
} from "../src/lib/guidedCall.ts";
import { buildDisplayMediaOptions } from "../src/lib/tabAudio.ts";

describe("silence detector", () => {
  const loud = 0.05;
  const quiet = 0;
  test("rmsOf", () => {
    assert.equal(rmsOf([]), 0);
    assert.equal(rmsOf([0, 0, 0]), 0);
    assert.ok(Math.abs(rmsOf([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9);
  });
  test("warns only after the threshold time of continuous silence", () => {
    let s = initialSilence();
    s = stepSilence(s, quiet, 1000);
    assert.equal(s.warning, false);
    s = stepSilence(s, quiet, 1000 + CALL_SILENCE.warnAfterMs - 1);
    assert.equal(s.warning, false);
    s = stepSilence(s, quiet, 1000 + CALL_SILENCE.warnAfterMs);
    assert.equal(s.warning, true);
  });
  test("sound resets the clock before the warning", () => {
    let s = initialSilence();
    s = stepSilence(s, quiet, 0);
    s = stepSilence(s, loud, 7000);
    s = stepSilence(s, quiet, 9000);
    assert.equal(s.warning, false);
    s = stepSilence(s, quiet, 9000 + CALL_SILENCE.warnAfterMs);
    assert.equal(s.warning, true);
  });
  test("the warning clears as soon as sound arrives", () => {
    let s = initialSilence();
    s = stepSilence(s, quiet, 0);
    s = stepSilence(s, quiet, 9000);
    assert.equal(s.warning, true);
    s = stepSilence(s, loud, 9100);
    assert.deepEqual(s, initialSilence());
  });
  test("unchanged state is returned as is (no needless re-render)", () => {
    const s0 = initialSilence();
    assert.equal(stepSilence(s0, loud, 5), s0);
    const s1 = stepSilence(s0, quiet, 0);
    assert.equal(stepSilence(s1, quiet, 100), s1);
  });
  test("a custom threshold is respected", () => {
    const cfg = { rmsThreshold: 0.1, warnAfterMs: 1000 };
    let s = stepSilence(initialSilence(), 0.05, 0, cfg);
    s = stepSilence(s, 0.05, 1000, cfg);
    assert.equal(s.warning, true);
  });
});

describe("call links", () => {
  test("https only", () => {
    assert.equal(openableCallUrl("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
    assert.equal(openableCallUrl("http://meet.google.com/abc"), null);
    assert.equal(openableCallUrl("javascript:alert(1)"), null);
    assert.equal(openableCallUrl("  "), null);
    assert.equal(openableCallUrl("not a link"), null);
    assert.equal(openableCallUrl(null), null);
  });
  test("rejects links with a user name or password", () => {
    assert.equal(openableCallUrl("https://user:pass@meet.google.com/abc"), null);
    assert.equal(openableCallUrl("https://meet.google.com@evil.com/abc"), null);
    assert.equal(openableCallUrl("https://user@zoom.us/j/1"), null);
  });
  test("recognises Meet, Teams, Zoom", () => {
    assert.equal(detectCallPlatform("https://meet.google.com/abc-defg-hij")?.id, "meet");
    assert.equal(detectCallPlatform("https://teams.microsoft.com/l/meetup-join/xyz")?.id, "teams");
    assert.equal(detectCallPlatform("https://teams.live.com/meet/123")?.id, "teams");
    assert.equal(detectCallPlatform("https://us02web.zoom.us/j/123456789?pwd=a")?.id, "zoom");
    assert.equal(detectCallPlatform("https://zoom.us/j/1")?.name, "Zoom");
  });
  test("Zoom mentions joining from the browser; others have no extra tip", () => {
    assert.match(detectCallPlatform("https://zoom.us/j/1")?.hint ?? "", /Join from your browser/);
    assert.equal(detectCallPlatform("https://meet.google.com/a")?.hint, undefined);
  });
  test("look-alike hosts and plain http are not recognised", () => {
    assert.equal(detectCallPlatform("https://notzoom.us/j/1"), null);
    assert.equal(detectCallPlatform("https://zoom.us.evil.com/j/1"), null);
    assert.equal(detectCallPlatform("https://evil.com/meet.google.com"), null);
    assert.equal(detectCallPlatform("http://meet.google.com/a"), null);
    assert.equal(detectCallPlatform("https://example.com/call"), null);
  });
});

describe("display options with unsupported constraints", () => {
  test("asks for the tab list only where the browser lists displaySurface", () => {
    assert.deepEqual(buildDisplayMediaOptions({ displaySurface: true }).video, { displaySurface: "browser" });
    assert.equal(buildDisplayMediaOptions({}).video, true);
    assert.equal(buildDisplayMediaOptions(null).video, true);
    assert.equal(buildDisplayMediaOptions(undefined).video, true);
  });
  test("a browser listing nothing still gets the base request and the hints", () => {
    const o = buildDisplayMediaOptions({});
    assert.equal(o.audio, true);
    assert.equal(o.preferCurrentTab, false);
    assert.equal(o.selfBrowserSurface, "exclude");
    assert.equal(o.surfaceSwitching, "include");
    assert.equal(o.systemAudio, "include");
  });
  test("unknown or false entries are ignored", () => {
    const o = buildDisplayMediaOptions({ displaySurface: false, somethingNew: true, echoCancellation: false });
    assert.equal(o.video, true);
    assert.equal(o.audio, true);
  });
});
