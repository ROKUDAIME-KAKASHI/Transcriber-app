import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  audioTrackCount, buildDisplayMediaOptions, guidedCallAvailable, displayMediaErrorMessage, safeCallUrl, tabAudioAvailable,
  type TabAudioEnv,
} from "../src/lib/tabAudio.ts";

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const env = (o: Partial<TabAudioEnv> = {}): TabAudioEnv => ({ native: false, userAgent: WIN_CHROME, coarsePointer: false, hasGetDisplayMedia: true, ...o });

describe("tabAudioAvailable", () => {
  test("laptop Chrome with getDisplayMedia", () => assert.equal(tabAudioAvailable(env()), true));
  test("hidden in the Android app", () => assert.equal(tabAudioAvailable(env({ native: true })), false));
  test("hidden without getDisplayMedia", () => assert.equal(tabAudioAvailable(env({ hasGetDisplayMedia: false })), false));
  test("hidden on coarse pointers (tablets)", () => assert.equal(tabAudioAvailable(env({ coarsePointer: true })), false));
  test("hidden on phone and tablet user agents", () => {
    for (const ua of ["Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/130 Mobile Safari/537.36", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"]) {
      assert.equal(tabAudioAvailable(env({ userAgent: ua })), false, ua);
    }
  });
});

describe("buildDisplayMediaOptions", () => {
  test("includes each supported audio option and the surface hints", () => {
    const o = buildDisplayMediaOptions({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, suppressLocalAudioPlayback: true });
    assert.deepEqual(o.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false });
    assert.equal(o.video, true);
    assert.equal(o.preferCurrentTab, false);
    assert.equal(o.selfBrowserSurface, "exclude");
    assert.equal(o.systemAudio, "include");
    assert.equal(o.surfaceSwitching, "include");
  });
  test("drops audio options the browser does not list", () => {
    const o = buildDisplayMediaOptions({ echoCancellation: true });
    assert.deepEqual(o.audio, { echoCancellation: false });
  });
  test("falls back to plain audio: true", () => {
    assert.equal(buildDisplayMediaOptions(null).audio, true);
    assert.equal(buildDisplayMediaOptions({}).audio, true);
  });
});

describe("audioTrackCount", () => {
  test("counts live audio tracks only", () => {
    assert.equal(audioTrackCount([]), 0);
    assert.equal(audioTrackCount([{ kind: "video" }]), 0);
    assert.equal(audioTrackCount([{ kind: "audio", readyState: "live" }, { kind: "audio", readyState: "ended" }]), 1);
  });
});

describe("safeCallUrl / error messages", () => {
  test("http(s) only", () => {
    assert.equal(safeCallUrl("https://zoom.us/j/1"), "https://zoom.us/j/1");
    assert.equal(safeCallUrl("javascript:alert(1)"), null);
    assert.equal(safeCallUrl("  "), null);
    assert.equal(safeCallUrl(undefined), null);
  });
  test("a dismissed picker reads as cancelled", () => assert.match(displayMediaErrorMessage("NotAllowedError"), /cancelled/));
});

describe("guidedCallAvailable (needs tab audio: Chromium on desktop only)", () => {
  const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0";
  test("Chrome and Edge on desktop", () => {
    assert.equal(guidedCallAvailable(env()), true);
    assert.equal(guidedCallAvailable(env({ userAgent: EDGE })), true);
  });
  test("not Firefox or Safari (no tab audio there)", () => {
    assert.equal(guidedCallAvailable(env({ userAgent: FIREFOX })), false);
    assert.equal(guidedCallAvailable(env({ userAgent: SAFARI })), false);
  });
  test("not in the app, on phones, or without getDisplayMedia", () => {
    assert.equal(guidedCallAvailable(env({ native: true })), false);
    assert.equal(guidedCallAvailable(env({ coarsePointer: true })), false);
    assert.equal(guidedCallAvailable(env({ hasGetDisplayMedia: false })), false);
  });
});
