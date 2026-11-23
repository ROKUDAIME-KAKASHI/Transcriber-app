import { test } from "node:test";
import assert from "node:assert/strict";
import { dateGroup } from "../src/lib/dateGroup.ts";

const now = new Date(2026, 10, 23, 12, 0);

test("same day is Today", () => {
  assert.equal(dateGroup(new Date(2026, 10, 23, 0, 1), now), "Today");
  assert.equal(dateGroup(new Date(2026, 10, 23, 23, 59), now), "Today");
});
test("previous calendar day is Yesterday", () => {
  assert.equal(dateGroup(new Date(2026, 10, 22, 23, 59), new Date(2026, 10, 23, 0, 1)), "Yesterday");
  assert.equal(dateGroup(new Date(2026, 10, 22, 8, 0), now), "Yesterday");
});
test("2 to 6 days ago is This week", () => {
  assert.equal(dateGroup(new Date(2026, 10, 21, 9, 0), now), "This week");
  assert.equal(dateGroup(new Date(2026, 10, 17, 9, 0), now), "This week");
});
test("7+ days ago is Earlier", () => {
  assert.equal(dateGroup(new Date(2026, 10, 16, 9, 0), now), "Earlier");
  assert.equal(dateGroup(new Date(2025, 0, 1), now), "Earlier");
});
test("future date is Today", () => {
  assert.equal(dateGroup(new Date(2026, 10, 25, 9, 0), now), "Today");
});
test("exactly 6 days ago is still This week", () => {
  assert.equal(dateGroup(new Date(2026, 10, 17, 23, 59), now), "This week");
});
