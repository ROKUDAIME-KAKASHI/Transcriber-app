import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleLocalKey } from "../src/lib/meetingExtras.ts";

const now = Date.now();
test("sweep: unscoped keys and month-old entries go, current scoped ones stay", () => {
  assert.equal(isStaleLocalKey("minutely.extras.cm123", "{}", now), true);
  assert.equal(isStaleLocalKey("minutely.ask.cm123", "[]", now), true);
  assert.equal(isStaleLocalKey("minutely.extras.userA.cm123", JSON.stringify({ at: now }), now), false);
  assert.equal(isStaleLocalKey("minutely.ask.userA.cm123", JSON.stringify({ at: now - 40 * 24 * 3600_000 }), now), true);
  assert.equal(isStaleLocalKey("minutely.other", null, now), false);
});
