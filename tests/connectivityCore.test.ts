import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, INITIAL_CONN } from "../src/lib/connectivityCore.ts";

test("initial state unknown", () => assert.deepEqual(INITIAL_CONN, { status: "unknown", failures: 0 }));

test("probe-ok -> online, failures reset", () => {
  const r = reduce({ status: "offline", failures: 3 }, { type: "probe-ok" });
  assert.deepEqual(r, { state: { status: "online", failures: 0 }, effect: null });
});

test("first fail while onLine retries, status kept", () => {
  const r = reduce({ status: "online", failures: 0 }, { type: "probe-fail", navigatorOnLine: true });
  assert.deepEqual(r, { state: { status: "online", failures: 1 }, effect: "retry-probe" });
});

test("second fail -> offline", () => {
  const r = reduce({ status: "online", failures: 1 }, { type: "probe-fail", navigatorOnLine: true });
  assert.equal(r.state.status, "offline");
});

test("fail with navigator offline -> offline immediately", () => {
  const r = reduce({ status: "online", failures: 0 }, { type: "probe-fail", navigatorOnLine: false });
  assert.equal(r.state.status, "offline");
  assert.equal(r.effect, null);
});

test("hint-offline -> offline immediately", () => {
  assert.equal(reduce({ status: "online", failures: 0 }, { type: "hint-offline" }).state.status, "offline");
});

test("hint-online -> probe-now, status unchanged", () => {
  const s = { status: "offline", failures: 2 } as const;
  const r = reduce(s, { type: "hint-online" });
  assert.deepEqual(r, { state: s, effect: "probe-now" });
});

test("plugin-disconnected only probes", () => {
  const s = { status: "online", failures: 0 } as const;
  assert.deepEqual(reduce(s, { type: "plugin-disconnected" }), { state: s, effect: "probe-now" });
});

test("unknown stays unknown after one failed probe", () => {
  const r = reduce(INITIAL_CONN, { type: "probe-fail", navigatorOnLine: true });
  assert.equal(r.state.status, "unknown");
  assert.equal(r.effect, "retry-probe");
});
