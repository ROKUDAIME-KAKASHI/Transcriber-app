import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  audioTrackCount, buildDisplayMediaOptions, defaultSource, displayMediaErrorMessage, safeCallUrl, showSourceSelector, tabAudioAvailable,
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
  test("the switch turns it off", () => {
    assert.equal(showSourceSelector(false, env()), false);
    assert.equal(showSourceSelector(true, env()), true);
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

describe("defaultSource", () => {
  test("a call link defaults to the tab on laptops", () => assert.equal(defaultSource({ available: true, callUrl: "https://meet.google.com/x", saved: null }), "tab"));
  test("never the tab when unavailable", () => assert.equal(defaultSource({ available: false, callUrl: "https://meet.google.com/x", saved: "tab" }), "mic"));
  test("otherwise the saved choice, mic by default", () => {
    assert.equal(defaultSource({ available: true, callUrl: null, saved: "tab" }), "tab");
    assert.equal(defaultSource({ available: true, callUrl: null, saved: null }), "mic");
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
