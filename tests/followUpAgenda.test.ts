import { test } from "node:test";
import assert from "node:assert/strict";
import { PolishBody, agendaFileName, buildAgendaDraft, cleanPolished, type AgendaItem } from "../src/lib/followUpAgenda.ts";

const mk = (task: string, over: Partial<AgendaItem> = {}): AgendaItem => ({
  task, owner: "Asha", dueDate: null, deadlineText: null, status: "NOT_STARTED", ...over,
});
const today = "2026-11-24";

test("groups in order and excludes done", () => {
  const out = buildAgendaDraft(
    [
      mk("write spec", { status: "NOT_STARTED", dueDate: "2026-12-01T00:00:00.000Z" }),
      mk("ship build", { status: "IN_PROGRESS" }),
      mk("fix login", { status: "BLOCKED", owner: "Ravi" }),
      mk("pay vendor", { dueDate: "2026-11-20T00:00:00.000Z" }),
      mk("old thing", { status: "DONE" }),
    ],
    { meetingTitle: "Weekly sync", today }
  );
  assert.equal(
    out,
    [
      "Follow-up agenda — Weekly sync",
      "",
      "1. Discuss the blocked fix login (Ravi)",
      "2. Confirm a new date for pay vendor — Asha, was due 20 Nov 2026",
      "3. Review progress on ship build (Asha)",
      "4. Check status of write spec (Asha, due 1 Dec 2026)",
      "5. Any new discussion topics",
    ].join("\n")
  );
  assert.ok(!out.includes("old thing"));
});

test("due today is not overdue; a blocked overdue task stays blocked", () => {
  const out = buildAgendaDraft(
    [mk("a", { dueDate: "2026-11-24T00:00:00.000Z" }), mk("b", { status: "BLOCKED", dueDate: "2026-11-01T00:00:00.000Z" })],
    { today }
  );
  assert.match(out, /1\. Discuss the blocked b \(Asha\)/);
  assert.match(out, /2\. Check status of a \(Asha, due 24 Nov 2026\)/);
  assert.ok(!out.includes("Confirm a new date"));
});

test("unassigned tasks need an owner; spoken deadline is used", () => {
  const out = buildAgendaDraft(
    [
      mk("draft plan", { owner: null, deadlineText: "by Friday" }),
      mk("call client", { owner: " ", status: "BLOCKED" }),
      mk("sign off", { owner: null, status: "IN_PROGRESS" }),
    ],
    { today }
  );
  assert.match(out, /Discuss the blocked call client — needs an owner/);
  assert.match(out, /Review progress on sign off — needs an owner/);
  assert.match(out, /Check status of draft plan \(due by Friday\) — needs an owner/);
});

test("overdue without an owner", () => {
  const out = buildAgendaDraft([mk("x", { owner: null, dueDate: "2026-11-01T00:00:00.000Z" })], { today });
  assert.match(out, /Confirm a new date for x — was due 1 Nov 2026 — needs an owner/);
});

test("nothing unfinished, and the default title", () => {
  const out = buildAgendaDraft([mk("a", { status: "DONE" })], { meetingTitle: "  ", today });
  assert.equal(
    out,
    "Follow-up agenda — Selected tasks\n\nAll tasks from this meeting are done.\n\n1. Any new discussion topics"
  );
  assert.ok(buildAgendaDraft([], { today }).includes("All tasks from this meeting are done."));
});

test("polish body, cleaning and file name", () => {
  assert.equal(PolishBody.safeParse({ draft: "" }).success, false);
  assert.equal(PolishBody.safeParse({ draft: "x".repeat(8001) }).success, false);
  assert.equal(PolishBody.safeParse({ draft: " hi " }).data?.draft, "hi");
  assert.equal(cleanPolished("```\n1. **Do** it\n```"), "1. Do it");
  assert.equal(agendaFileName("Weekly sync!"), "follow-up-agenda-weekly-sync.txt");
  assert.equal(agendaFileName("!!!"), "follow-up-agenda.txt");
});
