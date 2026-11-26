import { test } from "node:test";
import assert from "node:assert/strict";
import { dueView, emptyTasksText, statusOverview } from "../src/lib/taskView.ts";
import { filterTasks, statusCounts, type TaskRow } from "../src/lib/taskTracker.ts";
import { initials, matchesQuery } from "../src/lib/stakeholders.ts";

const mk = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id, task: id, owner: null, deadlineText: null, dueDate: null, sourceQuote: "", status: "NOT_STARTED", note: null,
  createdAt: "2026-11-01T10:00:00.000Z", meeting: { id: "m1", title: "Standup", createdAt: "2026-11-01T09:00:00.000Z" }, ...over,
});

test("statusOverview maps the counts to the real statuses, in order", () => {
  const items = [mk("a"), mk("b", { status: "IN_PROGRESS" }), mk("c", { status: "BLOCKED" }), mk("d", { status: "DONE" }), mk("e", { status: "DONE" })];
  const o = statusOverview(statusCounts(items, { owner: "", meetingId: "" }));
  assert.deepEqual(o.map((x) => [x.label, x.count]), [["Open", 3], ["Not started", 1], ["In progress", 1], ["Blocked", 1], ["Done", 2]]);
});

test("counts follow the owner and meeting filters, the shown list follows the status chip", () => {
  const items = [mk("a", { owner: "Asha" }), mk("b", { owner: "Ben", status: "DONE" }), mk("c", { owner: "Asha", status: "DONE" })];
  const counts = statusCounts(items, { owner: "Asha", meetingId: "" });
  assert.equal(counts.open, 1);
  assert.equal(counts.DONE, 1);
  assert.equal(filterTasks(items, { status: "DONE", owner: "Asha", meetingId: "" }).length, 1);
});

test("empty text depends on the filter", () => {
  assert.equal(emptyTasksText("open", false), "No open tasks. You're all caught up.");
  assert.equal(emptyTasksText("BLOCKED", false), "Nothing is blocked.");
  assert.equal(emptyTasksText("DONE", false), "No finished tasks yet.");
  assert.equal(emptyTasksText("all", false), "Tasks from your meetings will appear here.");
  assert.equal(emptyTasksText("open", true), "No tasks match these filters.");
});

test("dueView flags overdue only for undone tasks with a past day", () => {
  assert.equal(dueView(mk("a", { dueDate: "2026-11-01T00:00:00.000Z" }), "2026-11-20").overdue, true);
  assert.equal(dueView(mk("a", { dueDate: "2026-11-20T00:00:00.000Z" }), "2026-11-20").overdue, false);
  assert.equal(dueView(mk("a", { dueDate: "2026-11-01T00:00:00.000Z", status: "DONE" }), "2026-11-20").overdue, false);
  const said = dueView(mk("a", { deadlineText: "by Friday" }), "2026-11-20");
  assert.equal(said.day, "");
  assert.equal(said.said, "by Friday");
});

test("people search covers name, email, designation and organisation", () => {
  const p = { name: "Asha Rao", email: "asha@acme.in", designation: "Site Engineer", organisation: "Acme Infra", area: null };
  for (const q of ["asha", "ACME.IN", "engineer", "infra", "  "]) assert.equal(matchesQuery(p, q), true, q);
  assert.equal(matchesQuery(p, "zzz"), false);
});

test("initials uses first and last word", () => {
  assert.equal(initials("Asha Rao"), "AR");
  assert.equal(initials("  madonna "), "M");
  assert.equal(initials("A B C"), "AC");
  assert.equal(initials(""), "?");
});
