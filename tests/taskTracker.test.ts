import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PatchBody, compareTasks, dueDay, distinctMeetings, distinctOwners, filterTasks, isOverdue, localToday,
  parseDateOnly, parseStatusFilter, sortTasks, statusCounts, UNASSIGNED, type TaskRow,
} from "../src/lib/taskTracker.ts";

const mk = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id, task: id, owner: null, deadlineText: null, dueDate: null, sourceQuote: "", status: "NOT_STARTED", note: null,
  createdAt: "2026-11-01T10:00:00.000Z", meeting: { id: "m1", title: "Standup", createdAt: "2026-11-01T09:00:00.000Z" }, ...over,
});

test("parseDateOnly accepts real dates only", () => {
  assert.equal(parseDateOnly("2026-11-24")?.toISOString(), "2026-11-24T00:00:00.000Z");
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("24/11/2026"), null);
  assert.equal(parseDateOnly(null), null);
});

test("dueDay and localToday", () => {
  assert.equal(dueDay("2026-11-24T00:00:00.000Z"), "2026-11-24");
  assert.equal(dueDay(null), "");
  assert.equal(dueDay("junk"), "");
  assert.equal(localToday(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("isOverdue", () => {
  const t = (dueDate: string | null, status: TaskRow["status"] = "NOT_STARTED") => ({ dueDate, status });
  assert.equal(isOverdue(t("2026-11-23T00:00:00.000Z"), "2026-11-24"), true);
  assert.equal(isOverdue(t("2026-11-24T00:00:00.000Z"), "2026-11-24"), false);
  assert.equal(isOverdue(t("2026-11-23T00:00:00.000Z", "DONE"), "2026-11-24"), false);
  assert.equal(isOverdue(t(null), "2026-11-24"), false);
});

test("sort: open first, due ascending, nulls last, newest created first", () => {
  const items = [
    mk("done", { status: "DONE", dueDate: "2026-11-01T00:00:00.000Z" }),
    mk("nodue-old", { createdAt: "2026-11-01T00:00:00.000Z" }),
    mk("nodue-new", { createdAt: "2026-11-05T00:00:00.000Z" }),
    mk("late", { dueDate: "2026-12-01T00:00:00.000Z" }),
    mk("soon", { dueDate: "2026-11-10T00:00:00.000Z", status: "BLOCKED" }),
  ];
  assert.deepEqual(sortTasks(items).map((i) => i.id), ["soon", "late", "nodue-new", "nodue-old", "done"]);
  assert.equal(compareTasks(items[0], items[0]), 0);
});

test("filters and counts", () => {
  const items = [
    mk("a", { owner: "Asha" }),
    mk("b", { owner: " asha ", status: "DONE" }),
    mk("c", { status: "IN_PROGRESS" }),
    mk("d", { owner: "Ravi", meeting: { id: "m2", title: "Plan", createdAt: "2026-11-03T00:00:00.000Z" } }),
  ];
  const f = { status: "open" as const, owner: "", meetingId: "" };
  assert.deepEqual(filterTasks(items, f).map((i) => i.id), ["a", "c", "d"]);
  assert.deepEqual(filterTasks(items, { ...f, status: "all", owner: "ASHA" }).map((i) => i.id), ["a", "b"]);
  assert.deepEqual(filterTasks(items, { ...f, owner: UNASSIGNED }).map((i) => i.id), ["c"]);
  assert.deepEqual(filterTasks(items, { ...f, status: "DONE" }).map((i) => i.id), ["b"]);
  assert.deepEqual(filterTasks(items, { ...f, meetingId: "m2" }).map((i) => i.id), ["d"]);
  const c = statusCounts(items, { owner: "", meetingId: "" });
  assert.deepEqual(c, { open: 3, all: 4, NOT_STARTED: 2, IN_PROGRESS: 1, BLOCKED: 0, DONE: 1 });
  assert.equal(statusCounts(items, { owner: "asha", meetingId: "" }).all, 2);
});

test("distinct owners and meetings", () => {
  const items = [mk("a", { owner: "Ravi" }), mk("b", { owner: "asha" }), mk("c", { owner: "Asha" }), mk("d", { owner: " " })];
  assert.deepEqual(distinctOwners(items), ["asha", "Ravi"]);
  const ms = distinctMeetings([
    mk("a"),
    mk("b", { meeting: { id: "m2", title: "Newer", createdAt: "2026-11-09T00:00:00.000Z" } }),
    mk("c"),
  ]);
  assert.deepEqual(ms, [{ id: "m2", title: "Newer" }, { id: "m1", title: "Standup" }]);
});

test("parseStatusFilter", () => {
  assert.equal(parseStatusFilter("DONE"), "DONE");
  assert.equal(parseStatusFilter("all"), "all");
  assert.equal(parseStatusFilter("bogus"), "open");
  assert.equal(parseStatusFilter(null), "open");
});

test("PatchBody", () => {
  assert.equal(PatchBody.safeParse({}).success, false);
  assert.equal(PatchBody.safeParse({ status: "NOPE" }).success, false);
  assert.equal(PatchBody.safeParse({ extra: 1, status: "DONE" }).success, false);
  assert.equal(PatchBody.safeParse({ owner: "x".repeat(101) }).success, false);
  assert.equal(PatchBody.safeParse({ note: "x".repeat(1001) }).success, false);
  assert.equal(PatchBody.safeParse({ task: "  " }).success, false);
  assert.equal(PatchBody.safeParse({ dueDate: "2026-13-01" }).success, false);
  const ok = PatchBody.parse({ status: "DONE", owner: "  ", dueDate: "2026-11-24", note: " hi ", task: " t " });
  assert.equal(ok.owner, null);
  assert.equal(ok.note, "hi");
  assert.equal(ok.task, "t");
  assert.equal(ok.dueDate?.toISOString(), "2026-11-24T00:00:00.000Z");
  assert.equal(PatchBody.parse({ dueDate: null }).dueDate, null);
  assert.equal(PatchBody.parse({ dueDate: "2026-11-24T00:00:00.000Z" }).dueDate?.toISOString(), "2026-11-24T00:00:00.000Z");
});
