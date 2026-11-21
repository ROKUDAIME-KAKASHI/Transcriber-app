import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMeetingId } from "../src/lib/meetingRoute.ts";
import { parentOf } from "../src/lib/navStack.ts";

const A = "abcdefghij0123456789";
const B = "zyxwvutsrq9876543210";

test("query id", () => assert.equal(resolveMeetingId(`?id=${A}`, "/meeting"), A));
test("path id", () => assert.equal(resolveMeetingId("", `/meetings/${A}`), A));
test("path id trailing slash", () => assert.equal(resolveMeetingId("", `/meetings/${A}/`), A));
test("query wins", () => assert.equal(resolveMeetingId(`?id=${A}`, `/meetings/${B}`), A));
test("invalid or missing", () => {
  assert.equal(resolveMeetingId("?id=short", "/meeting"), null);
  assert.equal(resolveMeetingId("", "/meeting"), null);
  assert.equal(resolveMeetingId("?id=../x", "/meeting"), null);
});
test("parentOf", () => {
  assert.equal(parentOf("/meeting"), "/meetings");
  assert.equal(parentOf("/meetings/abc"), "/meetings");
  assert.equal(parentOf("/"), "/");
});
