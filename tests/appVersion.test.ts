import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, describeInstalled, isAndroidUserAgent, isOlderBuild, newerRelease, parseApkRelease } from "../src/lib/appVersion.ts";

const R = { versionCode: 2, versionName: "1.1", url: "/downloads/Minutely.apk", notes: "n" };

describe("appVersion", () => {
  test("isOlderBuild", () => {
    assert.equal(isOlderBuild(null, 2), false);
    assert.equal(isOlderBuild(1, 2), true);
    assert.equal(isOlderBuild(2, 2), false);
    assert.equal(isOlderBuild(3, 2), false);
  });
  test("parseApkRelease accepts a valid payload", () => assert.deepEqual(parseApkRelease(R), R));
  test("parseApkRelease rejects junk", () => {
    for (const bad of [null, "x", {}, { ...R, versionCode: 0 }, { ...R, versionCode: 1.5 }, { ...R, versionName: " " }, { ...R, url: "https://evil.test/a.apk" }]) {
      assert.equal(parseApkRelease(bad), null);
    }
  });
  test("parseApkRelease tolerates missing notes", () => assert.equal(parseApkRelease({ ...R, notes: undefined })?.notes, ""));
  test("newerRelease", () => {
    const n = { ...R, versionCode: 3, versionName: "1.2" };
    assert.equal(newerRelease(R, n), n);
    assert.equal(newerRelease(R, { ...R }), R);
    assert.equal(newerRelease(n, R), n);
    assert.equal(newerRelease(R, null), R);
  });
  test("isAndroidUserAgent", () => {
    assert.equal(isAndroidUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120"), true);
    assert.equal(isAndroidUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), false);
    assert.equal(isAndroidUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), false);
  });
  test("absoluteUrl", () => {
    assert.equal(absoluteUrl("https://a.test/", "/x.apk"), "https://a.test/x.apk");
    assert.equal(absoluteUrl("https://a.test", "x.apk"), "https://a.test/x.apk");
  });
  test("describeInstalled", () => {
    assert.equal(describeInstalled({ code: 2, name: "1.1" }), "1.1 (build 2)");
    assert.equal(describeInstalled({ code: 1, name: null }), "1.0 or older");
    assert.equal(describeInstalled({ code: 5, name: null }), "build 5");
    assert.equal(describeInstalled(null), "");
  });
});
