import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nextTailBatch,
  classifyResponse,
  backoffDelay,
  emptyDirty,
  computePending,
  shouldClearTail,
  mergePulledMeeting,
  planMissing,
} from "../src/lib/local/syncCore.ts";

const P = (text: string, i = 0) => ({ speaker: 0, text, t: i });
const mk = (n: number, text = "hi") => Array.from({ length: n }, (_, i) => P(text, i));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function local(over: Record<string, unknown> = {}): any {
  return {
    id: "m".repeat(20), userId: "u", title: "T", titleUpdatedAt: null, language: "en", engine: null,
    deviceName: null, status: "DONE", durationSec: 10, createdAt: "2026-01-01T00:00:00.000Z",
    template: null, document: null, speakerNames: null, origin: "server", partsCount: 3,
    hasTranscript: true, savedParts: 3, localRev: 1, serverUpdatedAt: "2026-01-01T00:00:00.000Z",
    dirty: emptyDirty(), pending: 0, deleted: 0, syncError: null, ...over,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function server(over: Record<string, unknown> = {}): any {
  return {
    id: "m".repeat(20), title: "T", status: "DONE", language: "en", durationSec: 10, deviceName: null,
    template: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("nextTailBatch", () => {
  test("empty", () => assert.deepEqual(nextTailBatch([], 0), { from: 0, parts: [], end: 0, done: true }));
  test("resends last confirmed part", () => {
    const b = nextTailBatch(mk(5), 3);
    assert.equal(b.from, 2);
    assert.equal(b.parts.length, 3);
    assert.equal(b.end, 5);
    assert.equal(b.done, true);
  });
  test("caps at 2000 parts then continues", () => {
    const parts = mk(5000);
    const b = nextTailBatch(parts, 0);
    assert.equal(b.parts.length, 2000);
    assert.equal(b.end, 2000);
    assert.equal(b.done, false);
    assert.equal(nextTailBatch(parts, 2000).from, 1999);
  });
  test("clamps savedParts beyond length", () => {
    const b = nextTailBatch(mk(3), 10);
    assert.equal(b.from, 3);
    assert.equal(b.parts.length, 0);
    assert.equal(b.done, true);
  });
  test("byte bound", () => {
    const big = "अ".repeat(400_000);
    const b = nextTailBatch([P(big), P(big), P(big)], 0);
    assert.equal(b.parts.length, 1);
    assert.equal(b.done, false);
  });
  test("oversize single part is sent alone", () => {
    const b = nextTailBatch([P("x".repeat(2_000_000))], 0);
    assert.equal(b.parts.length, 1);
    assert.equal(b.done, true);
  });
  test("maxParts limits batch", () => {
    const b = nextTailBatch(mk(10), 0, 4);
    assert.equal(b.parts.length, 4);
    assert.equal(b.done, false);
  });
});

describe("classifyResponse", () => {
  test("classes", () => {
    for (const s of [200, 201, 204]) assert.equal(classifyResponse(s), "ok");
    assert.equal(classifyResponse(401), "auth");
    assert.equal(classifyResponse(403), "auth");
    assert.equal(classifyResponse(409), "conflict");
    assert.equal(classifyResponse(413), "too-large");
    assert.equal(classifyResponse(404), "not-found");
    assert.equal(classifyResponse(400), "bad-request");
    assert.equal(classifyResponse(422), "bad-request");
    assert.equal(classifyResponse(500), "retry");
    assert.equal(classifyResponse(429), "retry");
    assert.equal(classifyResponse(null), "retry");
  });
});

describe("backoffDelay", () => {
  test("base, growth, cap", () => {
    assert.equal(backoffDelay(0, () => 0.5), 2000);
    assert.equal(backoffDelay(1, () => 0.5), 4000);
    assert.equal(backoffDelay(20, () => 0.5), 60000);
  });
  test("jitter within 20%", () => {
    assert.equal(backoffDelay(0, () => 0), 1600);
    assert.equal(backoffDelay(0, () => 1), 2400);
  });
});

describe("pending / tail guard", () => {
  test("computePending", () => {
    assert.equal(computePending(emptyDirty(), 0), 0);
    assert.equal(computePending({ ...emptyDirty(), meta: true }, 0), 1);
    assert.equal(computePending(emptyDirty(), 1), 1);
  });
  test("shouldClearTail", () => {
    assert.equal(shouldClearTail(5, 5, 10, 10), true);
    assert.equal(shouldClearTail(5, 6, 10, 10), false);
    assert.equal(shouldClearTail(5, 5, 9, 10), false);
  });
});

describe("mergePulledMeeting", () => {
  test("insert new", () => {
    const r = mergePulledMeeting(undefined, server(), "u");
    assert.equal(r.action, "insert");
    assert.equal(r.next!.origin, "server");
    assert.equal(r.next!.pending, 0);
    assert.equal(r.next!.hasTranscript, false);
    assert.equal(r.refetch, false);
  });
  test("deleted skip", () => {
    assert.equal(mergePulledMeeting(local({ deleted: 1, pending: 1 }), server(), "u").action, "skip");
  });
  test("server template wins", () => {
    const r = mergePulledMeeting(local({ template: "MOM" }), server({ template: "Report" }), "u");
    assert.equal(r.next!.template, "Report");
  });
  test("title LWW local newer", () => {
    const l = local({ title: "mine", titleUpdatedAt: "2026-02-01T00:00:00.000Z", dirty: { ...emptyDirty(), meta: true }, pending: 1 });
    const r = mergePulledMeeting(l, server({ title: "theirs", titleUpdatedAt: "2026-01-15T00:00:00.000Z" }), "u");
    assert.equal(r.next!.title, "mine");
    assert.equal(r.next!.dirty.meta, true);
  });
  test("title LWW server newer", () => {
    const l = local({ title: "mine", titleUpdatedAt: "2026-01-01T00:00:00.000Z", dirty: { ...emptyDirty(), meta: true }, pending: 1 });
    const r = mergePulledMeeting(l, server({ title: "theirs", titleUpdatedAt: "2026-01-15T00:00:00.000Z" }), "u");
    assert.equal(r.next!.title, "theirs");
    assert.equal(r.next!.dirty.meta, false);
  });
  test("dirty tail untouched", () => {
    const l = local({ status: "RECORDING", durationSec: 5, partsCount: 7, dirty: { ...emptyDirty(), tail: true }, pending: 1 });
    const r = mergePulledMeeting(l, server({ updatedAt: "2027-01-01T00:00:00.000Z", durationSec: 99 }), "u");
    assert.equal(r.next!.status, "RECORDING");
    assert.equal(r.next!.durationSec, 5);
    assert.equal(r.next!.partsCount, 7);
    assert.equal(r.refetch, false);
  });
  test("native RECORDING not changed", () => {
    const r = mergePulledMeeting(local({ origin: "native", status: "RECORDING" }), server({ status: "RECORDING", updatedAt: "2027-01-01T00:00:00.000Z" }), "u");
    assert.equal(r.next!.status, "RECORDING");
    assert.equal(r.refetch, false);
  });
  test("native DONE newer refetches", () => {
    const r = mergePulledMeeting(local({ origin: "native", status: "RECORDING" }), server({ status: "DONE", updatedAt: "2027-01-01T00:00:00.000Z" }), "u");
    assert.equal(r.next!.status, "DONE");
    assert.equal(r.refetch, true);
  });
  test("clean newer refetches", () => {
    const r = mergePulledMeeting(local(), server({ updatedAt: "2027-01-01T00:00:00.000Z" }), "u");
    assert.equal(r.refetch, true);
  });
  test("dirty.create cleared", () => {
    const r = mergePulledMeeting(local({ dirty: { ...emptyDirty(), create: true }, pending: 1 }), server(), "u");
    assert.equal(r.next!.dirty.create, false);
  });
  test("identical -> skip", () => {
    assert.equal(mergePulledMeeting(local(), server(), "u").action, "skip");
  });
});

describe("planMissing", () => {
  test("rules", () => {
    assert.equal(planMissing(local({ dirty: { ...emptyDirty(), create: true }, pending: 1 })), "keep");
    assert.equal(planMissing(local({ dirty: { ...emptyDirty(), tail: true }, pending: 1 })), "recreate");
    assert.equal(planMissing(local()), "remove");
  });
});
