import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginGuard, clientIp } from "../src/lib/loginLimit.ts";

test("blocks an email after 10 failures, case and spacing ignored", () => {
  const g = new LoginGuard();
  for (let i = 0; i < 10; i++) {
    assert.equal(g.blocked(" A@x.com ", "1.1.1.1", 1000), false);
    g.fail(i % 2 ? "a@x.com" : " A@X.com", "1.1.1." + i, 1000);
  }
  assert.equal(g.blocked("a@x.com", "9.9.9.9", 1000), true);
  assert.equal(g.blocked("b@x.com", "9.9.9.9", 1000), false);
});

test("window expires and success resets the email", () => {
  const g = new LoginGuard();
  for (let i = 0; i < 10; i++) g.fail("a@x.com", "unknown", 0);
  assert.equal(g.blocked("a@x.com", "unknown", 15 * 60 * 1000 + 1), false);
  g.success("A@x.com");
  assert.equal(g.blocked("a@x.com", "unknown", 1), false);
});

test("blocks an IP after 30 failures across emails", () => {
  const g = new LoginGuard();
  for (let i = 0; i < 30; i++) g.fail(`u${i}@x.com`, "2.2.2.2", 0);
  assert.equal(g.blocked("new@x.com", "2.2.2.2", 1), true);
  assert.equal(g.blocked("new@x.com", "3.3.3.3", 1), false);
});

test("clientIp takes the first forwarded address", () => {
  assert.equal(clientIp("1.2.3.4, 5.6.7.8"), "1.2.3.4");
  assert.equal(clientIp(undefined), "unknown");
});
