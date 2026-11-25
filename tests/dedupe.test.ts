import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateMeetings, findRepeatBookings, findTaskDuplicates, matchTask, normalizeTaskText, similarity, skipExactDuplicates,
} from "../src/lib/dedupe.ts";
import { splitLongPhrases } from "../src/lib/actionItems.ts";
import { describeEvent, diffTask, sortEvents } from "../src/lib/taskHistory.ts";

test("normalizeTaskText strips case, punctuation, articles, spacing", () => {
  assert.equal(normalizeTaskText("  Send   THE report, to Asha! "), "send report to asha");
  assert.equal(normalizeTaskText("A the an"), "");
  assert.equal(normalizeTaskText("रिपोर्ट भेजो।"), "रिपोर्ट भेजो");
});

test("similarity is token Jaccard", () => {
  assert.equal(similarity("send report", "Send the report."), 1);
  assert.equal(similarity("send report", "book room"), 0);
  assert.equal(similarity("", "x"), 0);
  assert.ok(similarity("send the weekly report to asha today", "send weekly report to asha") >= 0.8);
});

test("matchTask distinguishes same, near and none", () => {
  const ex = ["Send the report", "Book a room for Friday standup now"];
  assert.deepEqual(matchTask("send report!", ex), { kind: "same", index: 0 });
  assert.deepEqual(matchTask("Book a room for Friday standup", ex), { kind: "near", index: 1 });
  assert.equal(matchTask("Call the vendor", ex), null);
  assert.equal(matchTask("...", ex), null);
});

test("skipExactDuplicates skips saved and in-request repeats", () => {
  const r = skipExactDuplicates([{ task: "Send report" }, { task: "send the report." }, { task: "Call Ravi" }], ["Call ravi"]);
  assert.deepEqual(r.fresh.map((i) => i.task), ["Send report"]);
  assert.equal(r.skipped, 2);
});

test("findTaskDuplicates only links tasks in the same meeting", () => {
  const t = (id: string, task: string, m: string) => ({ id, task, meeting: { id: m } });
  const map = findTaskDuplicates([t("1", "send weekly report to asha", "m1"), t("2", "Send the weekly report to Asha.", "m1"), t("3", "send weekly report to asha", "m2")]);
  assert.equal(map.get("1"), "2");
  assert.equal(map.get("2"), "1");
  assert.equal(map.has("3"), false);
});

test("findDuplicateMeetings: title, 10 minute start window, 20% length", () => {
  const m = (id: string, title: string, at: string, d: number) => ({ id, title, createdAt: at, durationSec: d });
  const ids = findDuplicateMeetings([
    m("a", "Weekly Sync", "2026-11-25T10:00:00Z", 1000),
    m("b", "weekly sync", "2026-11-25T10:08:00Z", 1150),
    m("c", "Weekly sync", "2026-11-25T10:09:00Z", 2000),
    m("d", "Weekly sync", "2026-11-25T11:00:00Z", 1000),
    m("e", "Other", "2026-11-25T10:00:00Z", 1000),
  ]);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("findRepeatBookings: same guest, overlap or same day", () => {
  const b = (id: string, email: string, s: string, e: string) => ({ id, guestEmail: email, startAt: s, endAt: e });
  const ids = findRepeatBookings(
    [
      b("1", "Guest@x.com", "2026-11-26T09:00:00Z", "2026-11-26T09:30:00Z"),
      b("2", "guest@x.com", "2026-11-26T15:00:00Z", "2026-11-26T15:30:00Z"),
      b("3", "guest@x.com", "2026-11-27T09:00:00Z", "2026-11-27T09:30:00Z"),
      b("4", "other@x.com", "2026-11-26T09:00:00Z", "2026-11-26T09:30:00Z"),
    ],
    "UTC"
  );
  assert.deepEqual([...ids].sort(), ["1", "2"]);
});

test("splitLongPhrases splits only over-limit phrases, keeping speaker", () => {
  const long = Array.from({ length: 30 }, () => "word").join(" ");
  const out = splitLongPhrases([{ speaker: 1, text: "short" }, { speaker: 2, text: long }], 50);
  assert.equal(out[0].text, "short");
  assert.ok(out.length > 2);
  assert.ok(out.slice(1).every((p) => p.speaker === 2 && p.text.length <= 50));
  assert.equal(out.slice(1).map((p) => p.text).join(" "), long);
});

test("diffTask yields one event per really-changed field", () => {
  const ev = diffTask(
    { status: "NOT_STARTED", owner: "Asha", dueDate: new Date("2026-11-30T00:00:00Z"), note: null },
    { status: "IN_PROGRESS", owner: "Asha", dueDate: "2026-11-30T00:00:00.000Z", note: "  call  " }
  );
  assert.deepEqual(ev.map((e) => [e.field, e.oldValue, e.newValue]), [["status", "NOT_STARTED", "IN_PROGRESS"], ["note", null, "call"]]);
  assert.equal(describeEvent(ev[0]), "Status: Not started → In progress");
  assert.equal(diffTask({ task: "x" }, { task: "y".repeat(500) })[0].newValue?.length, 300);
});

test("sortEvents is newest first and capped", () => {
  const e = (i: number) => ({ createdAt: new Date(2026, 0, i + 1).toISOString() });
  const out = sortEvents(Array.from({ length: 25 }, (_, i) => e(i)));
  assert.equal(out.length, 20);
  assert.ok(out[0].createdAt > out[1].createdAt);
});

test("Devanagari conjunct with a joiner stays one word", () => {
  assert.equal(normalizeTaskText("क्\u200dष काम"), "क्ष काम");
});
