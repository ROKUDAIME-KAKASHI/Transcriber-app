import { test } from "node:test";
import assert from "node:assert/strict";
import { moveActive, rankCommands, scoreText, type Command } from "../src/lib/commandMatch.ts";

const cmds: Command[] = [
  { id: "record", label: "Start recording", group: "Actions", keywords: "record new meeting" },
  { id: "theme", label: "Toggle theme", group: "Actions", keywords: "dark light" },
  { id: "go-meetings", label: "Go to Meetings", group: "Go to" },
  { id: "go-tasks", label: "Go to Tasks", group: "Go to" },
  { id: "m1", label: "Weekly standup", group: "Meetings" },
  { id: "m2", label: "Budget review", group: "Meetings" },
  { id: "p1", label: "Asha Rao", group: "People", hint: "asha@acme.in" },
];

test("scoreText ranks prefix over word prefix over substring over letters in order", () => {
  assert.ok(scoreText("sta", "Start recording") > scoreText("rec", "Start recording"));
  assert.ok(scoreText("rec", "Start recording") > scoreText("tart", "Start recording"));
  assert.ok(scoreText("tart", "Start recording") > scoreText("srg", "Start recording"));
  assert.equal(scoreText("zzz", "Start recording"), 0);
});

test("empty query lists actions and go-to only, in order", () => {
  assert.deepEqual(rankCommands("", cmds).map((c) => c.id), ["record", "theme", "go-meetings", "go-tasks"]);
});

test("a query finds meetings and people as well as commands", () => {
  assert.deepEqual(rankCommands("stand", cmds).map((c) => c.id), ["m1"]);
  assert.deepEqual(rankCommands("asha", cmds).map((c) => c.id), ["p1"]);
});

test("keywords find a command, but the label match wins", () => {
  assert.equal(rankCommands("dark", cmds)[0].id, "theme");
  const r = rankCommands("meet", cmds).map((c) => c.id);
  assert.equal(r[0], "go-meetings"); // label word prefix beats the "meeting" keyword on Start recording
  assert.ok(r.includes("record"));
});

test("diacritics and case are ignored; every query word must match", () => {
  assert.deepEqual(rankCommands("BUDGET rev", cmds).map((c) => c.id), ["m2"]);
  assert.deepEqual(rankCommands("budget zzz", cmds), []);
});

test("moveActive wraps and handles no results", () => {
  assert.equal(moveActive(-1, 1, 3), 0);
  assert.equal(moveActive(2, 1, 3), 0);
  assert.equal(moveActive(0, -1, 3), 2);
  assert.equal(moveActive(0, 1, 0), -1);
});
