import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAuth, isStaleProbe } from "../src/lib/authCore.ts";

test("pending within grace -> skeleton", () => {
  assert.equal(decideAuth({ probe: "pending", cached: true, waitedMs: 6000 }), "skeleton");
});
test("pending past grace with cache -> app-cached", () => {
  assert.equal(decideAuth({ probe: "pending", cached: true, waitedMs: 6001 }), "app-cached");
});
test("pending past grace no cache -> needs-internet", () => {
  assert.equal(decideAuth({ probe: "pending", cached: false, waitedMs: 7000 }), "needs-internet");
});
test("ok-user -> app", () => {
  assert.equal(decideAuth({ probe: "ok-user", cached: false, waitedMs: 0 }), "app");
});
test("ok-empty -> redirect-login regardless of cache", () => {
  assert.equal(decideAuth({ probe: "ok-empty", cached: true, waitedMs: 0 }), "redirect-login");
  assert.equal(decideAuth({ probe: "ok-empty", cached: false, waitedMs: 0 }), "redirect-login");
});
test("unreachable with cache -> app-cached", () => {
  assert.equal(decideAuth({ probe: "unreachable", cached: true, waitedMs: 0 }), "app-cached");
});
test("unreachable without cache -> needs-internet", () => {
  assert.equal(decideAuth({ probe: "unreachable", cached: false, waitedMs: 0 }), "needs-internet");
});

test("stale pre-sign-in probe is discarded; the post-sign-in probe wins", () => {
  // initial probe gen 1 (ok-empty), sign-in recheck bumps to gen 2
  assert.equal(isStaleProbe(1, 2), true);
  assert.equal(isStaleProbe(2, 2), false);
});
test("ok-empty before sign-in redirects; ok-user after recheck enters app", () => {
  assert.equal(decideAuth({ probe: "ok-empty", cached: false, waitedMs: 0 }), "redirect-login");
  assert.equal(decideAuth({ probe: "ok-user", cached: false, waitedMs: 0 }), "app");
});
