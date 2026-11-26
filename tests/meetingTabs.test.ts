import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTab, parseTabParam, pickInitialTab, visibleTabs, withTabParam } from "../src/lib/meetingTabs.ts";

test("visible tabs follow the switches", () => {
  assert.deepEqual(visibleTabs({ tabs: true, actions: true, ask: true }), ["minutes", "actions", "transcript", "ask"]);
  assert.deepEqual(visibleTabs({ tabs: true, actions: false, ask: false }), ["minutes", "transcript"]);
  assert.deepEqual(visibleTabs({ tabs: false, actions: true, ask: true }), ["minutes", "transcript", "actions"]);
  assert.deepEqual(visibleTabs({ tabs: false, actions: false, ask: true }), ["minutes", "transcript"]);
});

test("?tab= accepts new and older names", () => {
  assert.equal(parseTabParam("summary"), "minutes");
  assert.equal(parseTabParam("minutes"), "minutes");
  assert.equal(parseTabParam("ASK"), "ask");
  assert.equal(parseTabParam("document"), "minutes");
  assert.equal(parseTabParam("tasks"), "actions");
  assert.equal(parseTabParam("nope"), null);
  assert.equal(parseTabParam(null), null);
});

test("initial tab: link beats remembered beats default; hidden tabs are skipped", () => {
  const visible = visibleTabs({ tabs: true, actions: true, ask: false });
  assert.equal(pickInitialTab({ param: "summary", saved: "actions", hasDoc: false, visible }), "minutes");
  assert.equal(pickInitialTab({ param: null, saved: "actions", hasDoc: false, visible }), "actions");
  assert.equal(pickInitialTab({ param: "ask", saved: "actions", hasDoc: false, visible }), "actions");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: true, visible }), "minutes");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: false, visible }), "transcript");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: false, visible: ["minutes", "transcript"] }), "transcript");
});

test("action items open first when there are any, otherwise minutes, otherwise the transcript", () => {
  const v = visibleTabs({ tabs: true, actions: true, ask: true });
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: true, hasActions: true, visible: v }), "actions");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: true, hasActions: false, visible: v }), "minutes");
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: false, hasActions: false, visible: v }), "transcript");
  // a link still wins, and a hidden actions tab is never picked
  assert.equal(pickInitialTab({ param: "transcript", saved: null, hasDoc: true, hasActions: true, visible: v }), "transcript");
  const noActions = visibleTabs({ tabs: true, actions: false, ask: false });
  assert.equal(pickInitialTab({ param: null, saved: null, hasDoc: true, hasActions: true, visible: noActions }), "minutes");
});

test("withTabParam keeps the meeting id", () => {
  assert.equal(withTabParam("?id=abc", "actions"), "?id=abc&tab=actions");
  assert.equal(withTabParam("?id=abc&tab=ask", "minutes"), "?id=abc&tab=minutes");
  assert.equal(withTabParam("", "ask"), "?tab=ask");
});

test("keyboard navigation wraps and supports Home/End", () => {
  const v = visibleTabs({ tabs: true, actions: true, ask: true });
  assert.equal(nextTab(v, "ask", "ArrowRight"), "minutes");
  assert.equal(nextTab(v, "minutes", "ArrowLeft"), "ask");
  assert.equal(nextTab(v, "transcript", "Home"), "minutes");
  assert.equal(nextTab(v, "minutes", "End"), "ask");
  assert.equal(nextTab(v, "minutes", "Enter"), null);
});
