import { test } from "node:test";
import assert from "node:assert/strict";
import { filterMeetings, formatHours, groupMeetings, listStats } from "../src/lib/meetingListView.ts";

const now = new Date(2026, 10, 23, 12, 0);
const mk = (title: string, d: Date, durationSec = 0, text?: string) => ({ title, createdAt: d.toISOString(), durationSec, text });
const items = [
  mk("Standup", new Date(2026, 10, 23, 9, 0), 1800),
  mk("Budget review", new Date(2026, 10, 22, 9, 0), 5400, "quarterly forecast"),
  mk("Planning", new Date(2026, 10, 20, 9, 0), 3600),
  mk("Old one", new Date(2026, 9, 1, 9, 0), 0),
];

test("stats: total, hours, this week", () => {
  const s = listStats(items, now);
  assert.equal(s.total, 4);
  assert.equal(s.hours, 3);
  assert.equal(s.thisWeek, 3);
});
test("stats hide when unavailable", () => {
  const s = listStats([mk("x", new Date(2026, 9, 1))], now);
  assert.equal(s.hours, null);
  assert.equal(s.thisWeek, 1 - 1);
  assert.equal(listStats([], now).thisWeek, null);
});
test("formatHours", () => {
  assert.equal(formatHours(12.46), "12 h");
  assert.equal(formatHours(2.5), "2.5 h");
});
test("filter by title, case-insensitive", () => {
  assert.deepEqual(filterMeetings(items, " STAND ").map((m) => m.title), ["Standup"]);
  assert.equal(filterMeetings(items, "").length, 4);
});
test("filter matches transcript text only when present", () => {
  assert.deepEqual(filterMeetings(items, "forecast").map((m) => m.title), ["Budget review"]);
  assert.equal(filterMeetings(items, "zzz").length, 0);
});
test("grouping", () => {
  const g = groupMeetings(items, now);
  assert.deepEqual(g.map((x) => x.label), ["Today", "Yesterday", "This week", "Earlier"]);
  assert.equal(groupMeetings(items, null).length, 1);
});
