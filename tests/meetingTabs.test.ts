import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTab, parseTabParam, pickInitialTab, visibleTabs, withTabParam } from "../src/lib/meetingTabs.ts";

test("visible tabs follow the switches", () => {
  assert.deepEqual(visibleTabs({ tabs: true, actions: true, ask: true }), ["transcript", "minutes", "summary", "actions", "ask"]);
  assert.deepEqual(visibleTabs({ tabs: true, actions: false, ask: false }), ["transcript", "minutes", "summary"]);
  assert.deepEqual(visibleTabs({ tabs: false, actions: true, ask: true }), ["minutes", "transcript", "actions"]);
  assert.deepEqual(visibleTabs({ tabs: false, actions: false, ask: true }), ["minutes", "transcript"]);
});

test("?tab= accepts new and older names", () => {
  assert.equal(parseTabParam("summary"), "summary");
  assert.equal(parseTabParam("ASK"), "ask");
  assert.equal(parseTabParam("document"), "minutes");
  assert.equal(parseTabParam("tasks"), "actions");
  assert.equal(parseTabParam("nope"), null);
  assert.equal(parseTabParam(null), null);
});

test("initial tab: link beats remembered beats default; hidden tabs are skipped", () => {
  const visible = visibleTabs({ tabs: true, actions: true, ask: false });
  assert.equal(pickInitialTab({ param: "summary", saved: "actions", hasDoc: false, visible }), "summary");
  assert.equal(pickInitialTab({ param: null, saved: "actions", hasDoc: false, visible }), "actions");
  assert.equal(pickInitialTab({ param: "ask", saved: "actions", hasDoc: false, visible }), "actions");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: true, visible }), "minutes");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: false, visible }), "transcript");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: false, visible: ["minutes", "transcript"] }), "transcript");
});

test("withTabParam keeps the meeting id", () => {
  assert.equal(withTabParam("?id=abc", "summary"), "?id=abc&tab=summary");
  assert.equal(withTabParam("?id=abc&tab=ask", "minutes"), "?id=abc&tab=minutes");
  assert.equal(withTabParam("", "ask"), "?tab=ask");
});

test("keyboard navigation wraps and supports Home/End", () => {
  const v = visibleTabs({ tabs: true, actions: true, ask: true });
  assert.equal(nextTab(v, "ask", "ArrowRight"), "transcript");
  assert.equal(nextTab(v, "transcript", "ArrowLeft"), "ask");
  assert.equal(nextTab(v, "minutes", "Home"), "transcript");
  assert.equal(nextTab(v, "minutes", "End"), "ask");
  assert.equal(nextTab(v, "minutes", "Enter"), null);
});
