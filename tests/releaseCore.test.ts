import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bumpAppRelease, bumpGradle, planRelease, readAppRelease, readGradleVersion } from "../scripts/releaseCore.mjs";

const GRADLE = `android {
    defaultConfig {
        applicationId "in.transcriber.app"
        versionCode 3
        versionName "1.2"
        testInstrumentationRunner "x"
    }
}`;

const TS = `export const LATEST_APK = {
  versionCode: 3,
  versionName: "1.2",
  url: "/downloads/Minutely.apk",
  notes: "New name: Minutely. Simpler booking.",
};`;

describe("releaseCore", () => {
  test("reads versions from both files", () => {
    assert.deepEqual(readGradleVersion(GRADLE), { versionCode: 3, versionName: "1.2" });
    assert.deepEqual(readAppRelease(TS), { versionCode: 3, versionName: "1.2" });
  });

  test("planRelease bumps code by one and validates input", () => {
    const cur = { versionCode: 3, versionName: "1.2" };
    assert.deepEqual(planRelease(cur, "1.3", " Fixes. "), { versionCode: 4, versionName: "1.3", notes: "Fixes." });
    assert.throws(() => planRelease(cur, "abc", "n"));
    assert.throws(() => planRelease(cur, "1.2", "n"));
    assert.throws(() => planRelease(cur, "1.3", "  "));
  });

  test("bumpGradle changes only the two version lines", () => {
    const out = bumpGradle(GRADLE, 4, "1.3");
    assert.match(out, /versionCode 4\n/);
    assert.match(out, /versionName "1.3"\n/);
    assert.equal(out.replace(/versionCode 4/, "versionCode 3").replace('"1.3"', '"1.2"'), GRADLE);
  });

  test("bumpAppRelease updates version and notes together, keeps the url", () => {
    const out = bumpAppRelease(TS, 4, "1.3", 'Say "hi" \\ done');
    assert.deepEqual(readAppRelease(out), { versionCode: 4, versionName: "1.3" });
    assert.match(out, /url: "\/downloads\/Minutely.apk"/);
    assert.match(out, /notes: "Say \\"hi\\" \\\\ done"/);
  });

  test("both files stay in step after a bump", () => {
    const plan = planRelease(readGradleVersion(GRADLE), "1.3", "n");
    const g = readGradleVersion(bumpGradle(GRADLE, plan.versionCode, plan.versionName));
    const r = readAppRelease(bumpAppRelease(TS, plan.versionCode, plan.versionName, plan.notes));
    assert.deepEqual(g, r);
  });

  test("bump throws when a version line is missing", () => {
    assert.throws(() => bumpGradle("nothing", 4, "1.3"));
    assert.throws(() => bumpAppRelease("nothing", 4, "1.3", "n"));
  });
});
