import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { dailySeries, engineKind, engineTotals, estimateDeepgramUsd, foldUsers, fmtDuration, windowTotals } from "../src/lib/adminStats.ts";
import { FailureLimiter, createToken, verifyPassword, verifyToken } from "../src/lib/adminAuthCore.ts";

const d = (s: string) => new Date(s);

describe("adminStats", () => {
  test("engineKind", () => {
    assert.equal(engineKind("deepgram"), "cloud");
    assert.equal(engineKind("moonshine"), "ondevice");
    assert.equal(engineKind("whisper"), "ondevice");
    assert.equal(engineKind(null), "unknown");
  });
  const rows = [
    { userId: "a", engine: "deepgram", count: 2, sumSec: 3600, lastAt: d("2026-11-10") },
    { userId: "a", engine: null, count: 1, sumSec: 600, lastAt: d("2026-11-12") },
    { userId: "b", engine: "whisper", count: 1, sumSec: 1800, lastAt: d("2026-11-11") },
  ];
  test("engineTotals", () => {
    assert.deepEqual(engineTotals(rows), { cloudSec: 3600, ondeviceSec: 1800, unknownSec: 600, meetings: 4, totalSec: 6000 });
  });
  test("foldUsers sorts by last activity, keeps idle users", () => {
    const users = [
      { id: "a", email: "a@x", createdAt: d("2026-01-01") },
      { id: "b", email: "b@x", createdAt: d("2026-01-02") },
      { id: "c", email: "c@x", createdAt: d("2026-01-03") },
    ];
    const out = foldUsers(rows, users);
    assert.deepEqual(out.map((u) => u.id), ["a", "b", "c"]);
    assert.equal(out[0].meetings, 3);
    assert.equal(out[0].cloudSec, 3600);
    assert.equal(out[0].lastAt?.toISOString().slice(0, 10), "2026-11-12");
    assert.equal(out[2].lastAt, null);
  });
  test("dailySeries zero-fills and buckets", () => {
    const s = dailySeries(
      [{ createdAt: d("2026-11-24T10:00:00Z"), durationSec: 60, engine: "deepgram" }, { createdAt: d("2026-09-01T00:00:00Z"), durationSec: 5 }],
      30,
      d("2026-11-24T12:00:00Z"),
    );
    assert.equal(s.length, 30);
    assert.equal(s[29].day, "2026-11-24");
    assert.equal(s[29].meetings, 1);
    assert.equal(s[29].cloudSec, 60);
    assert.equal(s.reduce((a, p) => a + p.meetings, 0), 1);
  });
  test("windowTotals", () => {
    const r = [{ createdAt: d("2026-11-20"), durationSec: 10 }, { createdAt: d("2026-11-01"), durationSec: 5 }];
    assert.deepEqual(windowTotals(r, d("2026-11-10")), { meetings: 1, sec: 10 });
  });
  test("cost and duration format", () => {
    assert.ok(Math.abs(estimateDeepgramUsd(6000, 0.01) - 1) < 1e-9);
    assert.equal(fmtDuration(3725), "1h 02m");
    assert.equal(fmtDuration(45), "45s");
  });
});

describe("adminAuthCore", () => {
  const salt = Buffer.from("saltsaltsaltsalt");
  const stored = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync("hunter2", salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64url")}`;
  test("verifyPassword", () => {
    assert.equal(verifyPassword("hunter2", stored), true);
    assert.equal(verifyPassword("nope", stored), false);
    assert.equal(verifyPassword("hunter2", undefined), false);
    assert.equal(verifyPassword("hunter2", "garbage"), false);
  });
  test("token roundtrip, tamper, expiry, wrong secret", () => {
    const t = createToken("s3cret", 1000);
    assert.equal(verifyToken(t, "s3cret", 2000), true);
    assert.equal(verifyToken(t, "other", 2000), false);
    assert.equal(verifyToken(t + "x", "s3cret", 2000), false);
    assert.equal(verifyToken(t, "s3cret", 1000 + 12 * 3600_000 + 1), false);
    assert.equal(verifyToken(undefined, "s3cret"), false);
    assert.equal(verifyToken(t, undefined), false);
  });
  test("limiter blocks after 5 failures then recovers", () => {
    const l = new FailureLimiter(5, 1000);
    for (let i = 0; i < 5; i++) l.fail("ip", 0);
    assert.equal(l.blocked("ip", 500), true);
    assert.equal(l.blocked("ip", 1500), false);
  });
});
