import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  carriedCount, carriedHeading, carriedLabel, carryPoints, chooseNextStart, dayInZone, mergeCarryOver, parseHeading, previousRecorded,
} from "../src/lib/followUp.ts";
import { buildAgendaDraft, type AgendaItem } from "../src/lib/followUpAgenda.ts";

const item = (o: Partial<AgendaItem>): AgendaItem => ({ task: "T", owner: "Asha", dueDate: null, deadlineText: null, status: "NOT_STARTED", ...o });
const H = "Carried over from Weekly sync (24 Nov 2026)";
const IST = "Asia/Kolkata";

describe("carryPoints", () => {
  const items = [
    item({ task: "Send deck", status: "NOT_STARTED" }),
    item({ task: "Fix login", status: "BLOCKED" }),
    item({ task: "Old thing", dueDate: "2026-11-01T00:00:00.000Z", status: "IN_PROGRESS" }),
    item({ task: "Draft plan", status: "IN_PROGRESS" }),
    item({ task: "Done thing", status: "DONE" }),
  ];
  test("orders blocked, overdue, in progress, not started and drops done", () => {
    const p = carryPoints(items, "2026-11-24");
    assert.equal(p.length, 4);
    assert.match(p[0], /^Discuss the blocked Fix login/);
    assert.match(p[1], /^Confirm a new date for Old thing/);
    assert.match(p[2], /^Review progress on Draft plan/);
    assert.match(p[3], /^Check status of Send deck/);
    assert.ok(!p.join("\n").includes("Done thing"));
  });
  test("buildAgendaDraft keeps its output", () => {
    const d = buildAgendaDraft(items, { meetingTitle: "X", today: "2026-11-24" });
    assert.match(d, /^Follow-up agenda — X\n\n1\. Discuss the blocked/);
    assert.match(d, /5\. Any new discussion topics$/);
  });
});

describe("heading", () => {
  test("round trips", () => {
    const h = carriedHeading("Weekly  sync", "2026-11-24");
    assert.equal(h, H);
    assert.deepEqual(parseHeading(h), { title: "Weekly sync", day: "2026-11-24" });
    assert.equal(parseHeading("Something else"), null);
  });
  test("dayInZone uses the zone", () => {
    assert.equal(dayInZone("2026-11-24T20:00:00Z", IST), "2026-11-25");
  });
});

describe("mergeCarryOver", () => {
  const pts = ["Review progress on A (Asha)", "Check status of B"];
  test("empty agenda gets heading, points and new topics", () => {
    const r = mergeCarryOver(null, pts, H);
    assert.equal(r.added, 2);
    assert.equal(r.agenda, `${H}\n\n1. Review progress on A (Asha)\n2. Check status of B\n3. Any new discussion topics`);
    assert.equal(carriedCount(r.agenda), 2);
  });
  test("no points still gives a usable agenda", () => {
    const r = mergeCarryOver("", [], H);
    assert.equal(r.added, 0);
    assert.match(r.agenda, /No unfinished tasks to carry over\.\n\n1\. Any new discussion topics/);
    assert.equal(carriedCount(r.agenda), 0);
  });
  test("existing agenda gets an appended block", () => {
    const r = mergeCarryOver("1. Budget\n2. Hiring", pts, H);
    assert.equal(r.agenda, `1. Budget\n2. Hiring\n\n${H}\n1. Review progress on A (Asha)\n2. Check status of B`);
    assert.equal(carriedCount(r.agenda), 2);
  });
  test("is idempotent", () => {
    const once = mergeCarryOver("1. Budget", pts, H).agenda;
    const twice = mergeCarryOver(once, pts, H);
    assert.equal(twice.added, 0);
    assert.equal(twice.agenda, once);
    const empty = mergeCarryOver(null, pts, H).agenda;
    assert.equal(mergeCarryOver(empty, pts, H).agenda, empty);
  });
  test("skips lines already there, ignoring numbering and case", () => {
    const r = mergeCarryOver("3. review progress on a (asha)\n- Budget", pts, H);
    assert.equal(r.added, 1);
    assert.ok(r.agenda.endsWith("1. Check status of B"));
  });
  test("adds only new points under an existing heading, continuing the numbers", () => {
    const first = mergeCarryOver("1. Budget", ["P1"], H).agenda;
    const r = mergeCarryOver(first, ["P1", "P2"], H);
    assert.equal(r.added, 1);
    assert.equal((r.agenda.match(/Carried over from/g) ?? []).length, 1);
    assert.ok(r.agenda.endsWith("2. P2"));
  });
  test("duplicate points collapse", () => {
    assert.equal(mergeCarryOver(null, ["A", "a", "B"], H).added, 2);
  });
  test("respects the size limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `Point number ${i} ${"x".repeat(40)}`);
    const r = mergeCarryOver(null, many, H, 500);
    assert.ok(r.agenda.length <= 500);
    assert.ok(r.added > 0 && r.added < 50);
  });
});

describe("carriedCount", () => {
  test("ignores the new topics line and text outside the block", () => {
    assert.equal(carriedCount(`${H}\n\n1. A\n2. B\n3. Any new discussion topics`), 2);
    assert.equal(carriedCount(`1. Own point\n\n${H}\n1. A\n\nNotes here\n2. Own`), 1);
    assert.equal(carriedCount(null), 0);
    assert.equal(carriedCount("1. A\n2. B"), 0);
  });
  test("label", () => {
    assert.equal(carriedLabel(1), "1 task carried over");
    assert.equal(carriedLabel(3), "3 tasks carried over");
  });
});

describe("chooseNextStart", () => {
  const src = new Date("2026-11-24T10:00:00Z").getTime(); // Tuesday 15:30 IST
  const now = new Date("2026-11-24T12:00:00Z").getTime();
  const base = { sourceStartMs: src, latestStartMs: src, timeZone: IST, nowMs: now, plannedStartsMs: [] as number[] };
  test("no series: one week later, same time", () => {
    const r = chooseNextStart({ ...base, cadence: null });
    assert.deepEqual(r, { startMs: new Date("2026-12-01T10:00:00Z").getTime(), reuse: false });
  });
  test("no series, old meeting: moves on by whole weeks into the future", () => {
    const r = chooseNextStart({ ...base, cadence: null, nowMs: new Date("2026-12-10T00:00:00Z").getTime() });
    assert.equal(r?.startMs, new Date("2026-12-15T10:00:00Z").getTime());
  });
  test("series uses cadence from the latest meeting", () => {
    const latest = new Date("2026-12-01T10:00:00Z").getTime();
    const r = chooseNextStart({ ...base, cadence: "BIWEEKLY", latestStartMs: latest });
    assert.deepEqual(r, { startMs: new Date("2026-12-15T10:00:00Z").getTime(), reuse: false });
  });
  test("series reuses an auto-planned occurrence", () => {
    const a = new Date("2026-12-01T10:00:00Z").getTime();
    const b = new Date("2026-12-08T10:00:00Z").getTime();
    const r = chooseNextStart({ ...base, cadence: "WEEKLY", plannedStartsMs: [b, a], latestStartMs: b });
    assert.deepEqual(r, { startMs: a, reuse: true });
  });
  test("ignores planned meetings in the past", () => {
    const past = new Date("2026-11-20T10:00:00Z").getTime();
    const r = chooseNextStart({ ...base, cadence: "WEEKLY", plannedStartsMs: [past] });
    assert.equal(r?.reuse, false);
  });
  test("monthly keeps the n-th weekday", () => {
    const r = chooseNextStart({ ...base, cadence: "MONTHLY" });
    assert.equal(r?.startMs, new Date("2026-12-22T10:00:00Z").getTime()); // 4th Tuesday
  });
});

describe("previousRecorded", () => {
  const plans = [
    { startAt: "2026-11-10T10:00:00Z", meetingId: "m1" },
    { startAt: "2026-11-17T10:00:00Z", meetingId: null },
    { startAt: "2026-11-24T10:00:00Z", meetingId: "m3" },
    { startAt: "2026-12-01T10:00:00Z", meetingId: "m4" },
  ];
  test("latest earlier plan that has a recording", () => {
    assert.equal(previousRecorded(plans, new Date("2026-11-24T10:00:00Z").getTime())?.meetingId, "m1");
    assert.equal(previousRecorded(plans, new Date("2026-12-01T10:00:00Z").getTime())?.meetingId, "m3");
    assert.equal(previousRecorded(plans, new Date("2026-11-10T10:00:00Z").getTime()), null);
  });
});
