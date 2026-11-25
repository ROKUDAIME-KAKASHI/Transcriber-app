import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, aggregateSeriesProgress, badgeText, distinctSeries, groupTimeline, matchOwnersToPeople, overdueBadgeLabel,
  overdueText, ownerOptions, parseSummary, progressLine, shouldToastOverdue, summarize, timelineSection, weekdayMon0,
} from "../src/lib/trackerPlus.ts";
import { filterTasks, type TaskRow } from "../src/lib/taskTracker.ts";

const mk = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id, task: id, owner: null, deadlineText: null, dueDate: null, sourceQuote: "", status: "NOT_STARTED", note: null,
  createdAt: "2026-11-01T10:00:00.000Z", meeting: { id: "m1", title: "Standup", createdAt: "2026-11-01T09:00:00.000Z" }, ...over,
});
const due = (d: string) => `${d}T00:00:00.000Z`;

// 2026-11-25 is a Wednesday.
const TODAY = "2026-11-25";

test("day arithmetic", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekdayMon0("2026-11-23"), 0);
  assert.equal(weekdayMon0("2026-11-29"), 6);
});

test("timeline sections on a Wednesday", () => {
  const s = (d: string | null, status: TaskRow["status"] = "NOT_STARTED") => timelineSection({ dueDate: d ? due(d) : null, status }, TODAY);
  assert.equal(s("2026-11-24"), "overdue");
  assert.equal(s("2026-11-25"), "today");
  assert.equal(s("2026-11-26"), "thisWeek");
  assert.equal(s("2026-11-29"), "thisWeek");
  assert.equal(s("2026-11-30"), "nextWeek");
  assert.equal(s("2026-12-06"), "nextWeek");
  assert.equal(s("2026-12-07"), "later");
  assert.equal(s(null), "none");
  assert.equal(s("2026-11-01", "DONE"), "done");
});

test("timeline on a Sunday: this week has nothing left, Monday is next week", () => {
  const s = (d: string) => timelineSection({ dueDate: due(d), status: "NOT_STARTED" }, "2026-11-29");
  assert.equal(s("2026-11-29"), "today");
  assert.equal(s("2026-11-30"), "nextWeek");
});

test("groupTimeline hides done unless asked, skips empty sections, sorts inside", () => {
  const items = [
    mk("later", { dueDate: due("2027-01-01") }),
    mk("o2", { dueDate: due("2026-11-20") }),
    mk("o1", { dueDate: due("2026-11-10") }),
    mk("nodate"),
    mk("done", { status: "DONE", dueDate: due("2026-11-01") }),
  ];
  const g = groupTimeline(items, TODAY, false);
  assert.deepEqual(g.map((x) => x.section), ["overdue", "later", "none"]);
  assert.deepEqual(g[0].items.map((i) => i.id), ["o1", "o2"]);
  assert.deepEqual(groupTimeline(items, TODAY, true).map((x) => x.section), ["overdue", "later", "none", "done"]);
  assert.equal(g[0].label, "Overdue");
});

test("summarize counts open, overdue and due today; done never counts", () => {
  const r = summarize(
    [mk("a", { dueDate: due("2026-11-01") }), mk("b", { dueDate: due(TODAY) }), mk("c"), mk("d", { status: "DONE", dueDate: due("2026-11-01") })],
    TODAY
  );
  assert.deepEqual(r, { overdue: 1, dueToday: 1, open: 3 });
});

test("parseSummary rejects bad shapes", () => {
  assert.deepEqual(parseSummary({ overdue: 2, dueToday: 0, open: 5 }), { overdue: 2, dueToday: 0, open: 5 });
  assert.equal(parseSummary({ overdue: -1, dueToday: 0, open: 5 }), null);
  assert.equal(parseSummary({ overdue: "2" }), null);
  assert.equal(parseSummary(null), null);
});

test("overdue wording", () => {
  assert.equal(overdueText(1), "1 task is overdue");
  assert.equal(overdueText(3), "3 tasks are overdue");
  assert.equal(overdueBadgeLabel(3), "3 overdue tasks");
  assert.equal(overdueBadgeLabel(1), "1 overdue task");
  assert.equal(badgeText(7), "7");
  assert.equal(badgeText(150), "99+");
});

test("daily toast rule", () => {
  const base = { enabled: true, overdue: 2, lastShownDay: null as string | null, today: TODAY };
  assert.equal(shouldToastOverdue(base), true);
  assert.equal(shouldToastOverdue({ ...base, lastShownDay: TODAY }), false);
  assert.equal(shouldToastOverdue({ ...base, lastShownDay: "2026-11-24" }), true);
  assert.equal(shouldToastOverdue({ ...base, overdue: 0 }), false);
  assert.equal(shouldToastOverdue({ ...base, enabled: false }), false);
});

test("series progress aggregation", () => {
  const meetings = [
    { meetingId: "a", title: "Week 1", date: "2026-11-02T10:00:00.000Z" },
    { meetingId: "b", title: "Week 2", date: "2026-11-09T10:00:00.000Z" },
    { meetingId: "c", title: "Week 3", date: "2026-11-16T10:00:00.000Z" },
  ];
  const tasks = [
    { meetingId: "a", status: "DONE", dueDate: due("2026-11-05") },
    { meetingId: "a", status: "DONE", dueDate: null },
    { meetingId: "b", status: "IN_PROGRESS", dueDate: due("2026-11-10") },
    { meetingId: "b", status: "NOT_STARTED", dueDate: due("2026-12-10") },
    { meetingId: "zzz", status: "DONE", dueDate: null },
    { meetingId: "b", status: "WEIRD", dueDate: null },
  ];
  const p = aggregateSeriesProgress(tasks, meetings, TODAY);
  assert.deepEqual(p.counts, { NOT_STARTED: 2, IN_PROGRESS: 1, BLOCKED: 0, DONE: 2 });
  assert.equal(p.total, 5);
  assert.equal(p.overdue, 1);
  assert.deepEqual(p.meetings.map((m) => [m.meetingId, m.done, m.total]), [["c", 0, 0], ["b", 0, 3], ["a", 2, 2]]);
  assert.equal(progressLine("Weekly review", p), "Weekly review · 2 done · 1 in progress · 2 not started · 1 overdue");
  assert.equal(progressLine("X", aggregateSeriesProgress([], [], TODAY)), "X · no tasks yet");
});

test("owner options group by person id, else by text", () => {
  const o = ownerOptions([
    { owner: "Asha Rao", ownerStakeholderId: "p1" },
    { owner: "Asha R.", ownerStakeholderId: "p1" },
    { owner: "ravi", ownerStakeholderId: null },
    { owner: " Ravi ", ownerStakeholderId: null },
    { owner: null, ownerStakeholderId: null },
  ]);
  assert.deepEqual(o, [{ value: "p:p1", label: "Asha Rao" }, { value: "ravi", label: "ravi" }]);
});

test("owner filter by person id and by text", () => {
  const items = [
    mk("a", { owner: "Asha Rao", ownerStakeholderId: "p1" }),
    mk("b", { owner: "Asha Rao" }),
    mk("c", { owner: "Ravi" }),
  ];
  const f = { status: "all" as const, meetingId: "" };
  assert.deepEqual(filterTasks(items, { ...f, owner: "p:p1" }).map((i) => i.id), ["a"]);
  assert.deepEqual(filterTasks(items, { ...f, owner: "asha rao" }).map((i) => i.id), ["b"]);
  assert.deepEqual(filterTasks(items, { ...f, owner: "" }).map((i) => i.id), ["a", "b", "c"]);
});

test("series filter and distinct series", () => {
  const items = [
    mk("a", { series: { id: "s1", title: "Weekly" } }),
    mk("b", { series: { id: "s1", title: "Weekly" } }),
    mk("c", { series: { id: "s2", title: "Board" } }),
    mk("d"),
  ];
  assert.deepEqual(filterTasks(items, { status: "all", owner: "", meetingId: "", seriesId: "s1" }).map((i) => i.id), ["a", "b"]);
  assert.deepEqual(distinctSeries(items), [{ id: "s2", title: "Board" }, { id: "s1", title: "Weekly" }]);
});

test("matchOwnersToPeople: exact case-insensitive, skips linked and ambiguous", () => {
  const people = [
    { id: "p1", name: "Asha Rao" },
    { id: "p2", name: "Ravi Kumar" },
    { id: "p3", name: "Sam Lee" },
    { id: "p4", name: "sam lee" },
  ];
  const tasks = [
    { id: "t1", owner: "asha rao" },
    { id: "t2", owner: " Asha Rao " },
    { id: "t3", owner: "Asha R" },
    { id: "t4", owner: "Ravi Kumar", ownerStakeholderId: "p2" },
    { id: "t5", owner: "Sam Lee" },
    { id: "t6", owner: null },
  ];
  const r = matchOwnersToPeople(tasks, people);
  assert.deepEqual(r.matches, [{ personId: "p1", name: "Asha Rao", taskIds: ["t1", "t2"] }]);
  assert.deepEqual(r.ambiguous, ["Sam Lee"]);
});
