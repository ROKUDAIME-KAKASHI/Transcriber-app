import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import routing from "../sw/routing.js";

const ID = "abcdefghij0123456789";
const O = "https://x.test";
const req = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => ({
  method: "GET", mode: "navigate", headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, ...over,
});
const r = (path: string, request = req()) => routing.route(new URL(path, O), request, O);

describe("shellFor", () => {
  for (const p of ["/", "/meetings", "/meeting", "/login", "/offline"]) {
    test(`shell ${p}`, () => assert.deepEqual(routing.shellFor(p), { shell: p }));
  }
  test("trailing slash", () => assert.deepEqual(routing.shellFor("/meetings/"), { shell: "/meetings" }));
  test("valid id redirects", () => assert.deepEqual(routing.shellFor("/meetings/" + ID), { redirect: "/meeting?id=" + ID }));
  test("short id", () => assert.deepEqual(routing.shellFor("/meetings/abc"), { shell: "/offline" }));
  test("uppercase id", () => assert.deepEqual(routing.shellFor("/meetings/" + ID.toUpperCase()), { shell: "/offline" }));
  test("extra segment", () => assert.deepEqual(routing.shellFor("/meetings/" + ID + "/x"), { shell: "/offline" }));
  test("unknown", () => assert.deepEqual(routing.shellFor("/nope"), { shell: "/offline" }));
});

describe("route", () => {
  test("non-GET", () => assert.equal(r("/", req({ method: "POST" })).kind, "pass"));
  test("cross-origin", () => assert.equal(routing.route(new URL("https://huggingface.co/a"), req(), O).kind, "pass"));
  for (const p of ["/api/x", "/api/auth/session", "/api/health"]) test(p, () => assert.equal(r(p).kind, "pass"));
  test("rsc header", () => assert.equal(r("/meetings", req({}, { rsc: "1" })).kind, "pass"));
  test("prefetch header", () => assert.equal(r("/meetings", req({}, { "next-router-prefetch": "1" })).kind, "pass"));
  test("segment prefetch header", () => assert.equal(r("/meetings", req({}, { "next-router-segment-prefetch": "/x" })).kind, "pass"));
  test("_rsc param", () => assert.equal(r("/meetings?_rsc=abc").kind, "pass"));
  test("static asset", () => assert.equal(r("/_next/static/chunks/a.js", req({ mode: "no-cors" })).kind, "asset"));
  test("ort asset", () => assert.equal(r("/ort/a.wasm", req({ mode: "cors" })).kind, "asset"));
  test("navigate", () => assert.deepEqual(r("/meetings"), { kind: "nav", shell: "/meetings" }));
  test("navigate redirect", () => assert.deepEqual(r("/meetings/" + ID), { kind: "nav", redirect: "/meeting?id=" + ID }));
  test("other GET", () => assert.equal(r("/icon.png", req({ mode: "no-cors" })).kind, "pass"));
});

test("MEETING_ID_RE parity", () => {
  const src = readFileSync(new URL("../src/lib/meetingId.ts", import.meta.url), "utf8");
  const m = /MEETING_ID_RE\s*=\s*(\/.+\/[a-z]*);/.exec(src);
  assert.ok(m);
  const lit = m[1];
  const re = new RegExp(lit.slice(1, lit.lastIndexOf("/")), lit.slice(lit.lastIndexOf("/") + 1));
  assert.equal(new RegExp(routing.MEETING_ID_RE_SOURCE).source, re.source);
});
