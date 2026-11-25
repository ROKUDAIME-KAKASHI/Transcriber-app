import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createReportGate, fingerprint, hashString, sanitizeUrl, scrubMessage, topFrame } from "../src/lib/errorLogCore.ts";

describe("errorLogCore", () => {
  test("hashString is stable and 16 hex chars", () => {
    assert.equal(hashString("abc"), hashString("abc"));
    assert.notEqual(hashString("abc"), hashString("abd"));
    assert.match(hashString("x"), /^[0-9a-f]{16}$/);
  });

  test("topFrame ignores line numbers, query strings and chunk hashes", () => {
    const a = "Error: x\n    at foo (https://h/_next/static/chunks/abcdef0123456789abcd.js?v=1:10:20)";
    const b = "Error: x\n    at foo (https://h/_next/static/chunks/zzzzzzzzzzzzzzzzzzzz.js?v=2:99:1)";
    assert.equal(topFrame(a), topFrame(b));
    assert.equal(topFrame(undefined), "");
  });

  test("same bug groups, different bug does not", () => {
    const s = "Error\n    at foo (a.js:1:1)";
    assert.equal(fingerprint("error", "Cannot read 12 of x", s), fingerprint("error", "Cannot read 99 of x", s));
    assert.notEqual(fingerprint("error", "boom", s), fingerprint("boundary", "boom", s));
    assert.notEqual(fingerprint("error", "boom", s), fingerprint("error", "bang", s));
  });

  test("sanitizeUrl drops query and fragment", () => {
    assert.equal(sanitizeUrl("https://x.app/meeting?id=secret#frag"), "https://x.app/meeting");
    assert.equal(sanitizeUrl("/book/asha?agenda=1"), "/book/asha");
    assert.equal(sanitizeUrl(""), null);
    assert.equal(sanitizeUrl(null), null);
  });

  test("scrubMessage removes query strings, bearer tokens and long tokens, and caps length", () => {
    assert.equal(scrubMessage("fetch https://a.b/c?token=abc failed"), "fetch https://a.b/c failed");
    assert.match(scrubMessage("Authorization Bearer abcdefghijklmnop1234"), /Bearer \[redacted\]/);
    assert.ok(!scrubMessage("key " + "a".repeat(40)).includes("aaaa"));
    assert.equal(scrubMessage("x".repeat(900).replace(/x/g, "y y ")).length <= 500, true);
  });

  test("report gate dedupes and caps at 10", () => {
    const g = createReportGate(10);
    assert.equal(g.allow("a"), true);
    assert.equal(g.allow("a"), false);
    for (let i = 0; i < 9; i++) assert.equal(g.allow("k" + i), true);
    assert.equal(g.allow("one-too-many"), false);
  });
});
