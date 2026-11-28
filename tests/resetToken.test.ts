import { test } from "node:test";
import assert from "node:assert/strict";
import { RESET_TTL_MS, matchesPassword, signResetToken, verifyResetToken } from "../src/lib/resetToken.ts";

const S = "test-secret-0123456789";
const H = "$2a$10$abcdefghijklmnopqrstuv";

test("valid token verifies and matches the current hash", () => {
  const t = signResetToken("u1", H, S, 1000);
  const p = verifyResetToken(t, S, 2000);
  assert.equal(p?.uid, "u1");
  assert.equal(p?.exp, 1000 + RESET_TTL_MS);
  assert.equal(matchesPassword(p!, H), true);
});

test("expired token is rejected", () => {
  const t = signResetToken("u1", H, S, 1000);
  assert.equal(verifyResetToken(t, S, 1000 + RESET_TTL_MS - 1) !== null, true);
  assert.equal(verifyResetToken(t, S, 1000 + RESET_TTL_MS), null);
});

test("tampered payload, signature, wrong secret and junk are rejected", () => {
  const t = signResetToken("u1", H, S, 1000);
  const [pl, sig] = t.split(".");
  const evil = Buffer.from(JSON.stringify({ uid: "u2", exp: 9e15, ph: "x" })).toString("base64url");
  assert.equal(verifyResetToken(`${evil}.${sig}`, S, 2000), null);
  assert.equal(verifyResetToken(`${pl}.${sig.slice(0, -2)}AA`, S, 2000), null);
  assert.equal(verifyResetToken(t, "other-secret", 2000), null);
  assert.equal(verifyResetToken(t + ".x", S, 2000), null);
  assert.equal(verifyResetToken("", S, 2000), null);
  assert.equal(verifyResetToken("garbage", S, 2000), null);
  assert.equal(verifyResetToken(t, undefined, 2000), null);
});

test("once the password changes the old token no longer matches", () => {
  const p = verifyResetToken(signResetToken("u1", H, S, 1000), S, 2000)!;
  assert.equal(matchesPassword(p, "$2a$10$differenthashafterreset"), false);
});
