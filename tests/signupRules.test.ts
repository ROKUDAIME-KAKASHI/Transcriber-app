import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEmailDomain } from "../src/lib/emailRule.ts";
import { checkPassword, isStrongPassword, passwordProblem } from "../src/lib/passwordRule.ts";
import { validateDeadline, localToday, maxDeadline } from "../src/lib/deadline.ts";

test("email domain: only exact gmail.com and jainuniversity.ac.in", () => {
  for (const ok of ["a@gmail.com", "  A.B@GMAIL.COM ", "x@jainuniversity.ac.in", "x@JainUniversity.ac.in"]) assert.equal(isAllowedEmailDomain(ok), true, ok);
  for (const bad of ["x@evilgmail.com", "x@gmail.com.evil", "x@sub.gmail.com", "x@jainuniversity.ac.in.evil", "x@yahoo.com", "gmail.com", "@gmail.com", "a@b@gmail.com", ""])
    assert.equal(isAllowedEmailDomain(bad), false, bad);
});

test("password: 8+ chars, a letter and a number", () => {
  assert.equal(isStrongPassword("abcd1234"), true);
  assert.equal(isStrongPassword("abcdefgh"), false);
  assert.equal(isStrongPassword("12345678"), false);
  assert.equal(isStrongPassword("abc123"), false);
  assert.deepEqual(checkPassword("abc").map((c) => c.ok), [false, true, false]);
  assert.equal(passwordProblem("abcd1234"), null);
  assert.match(passwordProblem("abcdefgh") ?? "", /number/);
});

const now = new Date(2026, 10, 26, 15, 0); // 26 Nov 2026, local
test("deadline: today ok, yesterday not, 5 years ok, beyond not", () => {
  assert.equal(localToday(now), "2026-11-26");
  assert.equal(maxDeadline(now), "2031-11-26");
  assert.equal(validateDeadline("2026-11-26", { now }), null);
  assert.equal(validateDeadline("2026-11-25", { now }), "Pick today or a later date.");
  assert.equal(validateDeadline("2031-11-26", { now }), null);
  assert.equal(validateDeadline("2031-11-27", { now }), "Pick a date within the next 5 years.");
  assert.equal(validateDeadline("2026-02-30", { now }), "Pick a valid date.");
});
test("deadline: empty is fine and an unchanged old date is kept", () => {
  assert.equal(validateDeadline("", { now }), null);
  assert.equal(validateDeadline(null, { now }), null);
  assert.equal(validateDeadline("2020-01-01", { now, previous: "2020-01-01T00:00:00.000Z" }), null);
  assert.notEqual(validateDeadline("2020-01-02", { now, previous: "2020-01-01" }), null);
});
