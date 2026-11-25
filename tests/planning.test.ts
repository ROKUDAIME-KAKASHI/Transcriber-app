import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LinkBody, PlanCreate, PlanPatch, SeriesCreate, blankForm, formFromPlan, formStart, inviteText, isHttpUrl, nextOccurrence,
  nextUpPlan, occurrenceAt, payloadFromForm, planPromptBlock, recordHref, upcomingPlans, type PlanDTO,
} from "../src/lib/planning.ts";
import { buildIcs, wallClockOf } from "../src/lib/scheduling.ts";

const NY = "America/New_York";
const IST = "Asia/Kolkata";
const iso = (s: string) => new Date(s).getTime();

function plan(over: Partial<PlanDTO> = {}): PlanDTO {
  return {
    id: "p1", title: "Weekly review", startAt: "2026-12-04T09:30:00.000Z", durationMin: 30, timeZone: IST, venue: "Room 4",
    callUrl: null, agenda: "1. Budget\n2. Hiring", status: "PLANNED", meetingId: null, bookingId: null, seriesId: null, series: null,
    attendees: [{ stakeholderId: null, name: "Asha Rao", email: "asha@example.com", designation: "CFO", role: null }, { stakeholderId: null, name: "Ben", email: null, designation: null, role: null }],
    ...over,
  };
}

describe("series dates", () => {
  test("weekly keeps the wall-clock time across a DST change", () => {
    const base = iso("2026-03-06T20:00:00Z"); // Fri 3:00 pm EST (UTC-5)
    const next = occurrenceAt(base, "WEEKLY", NY, 1)!;
    assert.equal(new Date(next).toISOString(), "2026-03-13T19:00:00.000Z"); // 3:00 pm EDT (UTC-4)
    const w = wallClockOf(next, NY);
    assert.deepEqual([w.h, w.min], [15, 0]);
  });
  test("biweekly adds 14 days; NONE repeats weekly", () => {
    const base = iso("2026-11-27T04:30:00Z"); // 10:00 am IST
    assert.equal(new Date(occurrenceAt(base, "BIWEEKLY", IST, 1)!).toISOString(), "2026-12-11T04:30:00.000Z");
    assert.equal(new Date(occurrenceAt(base, "NONE", IST, 1)!).toISOString(), "2026-12-04T04:30:00.000Z");
  });
  test("monthly keeps the n-th weekday", () => {
    const base = iso("2026-11-10T04:30:00Z"); // 2nd Tuesday of Nov
    assert.equal(new Date(occurrenceAt(base, "MONTHLY", IST, 1)!).toISOString(), "2026-12-08T04:30:00.000Z");
  });
  test("a 5th weekday falls back to the last one", () => {
    const base = iso("2026-11-30T04:30:00Z"); // 5th Monday of Nov
    assert.equal(new Date(occurrenceAt(base, "MONTHLY", IST, 1)!).toISOString(), "2026-12-28T04:30:00.000Z");
  });
  test("a time skipped by spring-forward moves to the next hour", () => {
    const base = iso("2026-03-01T07:30:00Z"); // Sun 2:30 am EST
    const next = occurrenceAt(base, "WEEKLY", NY, 1)!; // Mar 8 2:30 does not exist
    assert.equal(new Date(next).toISOString(), "2026-03-08T07:30:00.000Z"); // 3:30 am EDT
  });
  test("nextOccurrence skips dates that have passed", () => {
    const base = iso("2026-11-27T04:30:00Z");
    const next = nextOccurrence(base, "WEEKLY", IST, iso("2026-12-20T00:00:00Z"))!;
    assert.equal(new Date(next).toISOString(), "2026-12-25T04:30:00.000Z");
  });
});

describe("form mapping", () => {
  test("plan -> form -> payload round trip in the plan's zone", () => {
    const f = formFromPlan(plan());
    assert.equal(f.date, "2026-12-04");
    assert.equal(f.time, "15:00");
    const r = payloadFromForm(f);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.body.startAt, "2026-12-04T09:30:00.000Z");
      assert.equal((r.body.attendees as unknown[]).length, 2);
      assert.equal(r.body.venue, "Room 4");
    }
  });
  test("a time that doesn't exist is an error", () => {
    const r = formStart({ date: "2026-03-08", time: "02:30", timeZone: NY });
    assert.equal(r.ok, false);
  });
  test("bad date and empty title are errors", () => {
    assert.equal(formStart({ date: "2026-02-30", time: "10:00", timeZone: IST }).ok, false);
    assert.equal(payloadFromForm({ ...formFromPlan(plan()), title: "  " }).ok, false);
  });
  test("javascript: links are rejected", () => {
    assert.equal(payloadFromForm({ ...formFromPlan(plan()), callUrl: "javascript:alert(1)" }).ok, false);
    assert.ok(isHttpUrl("https://meet.google.com/abc"));
    assert.equal(isHttpUrl("intent://x"), false);
  });
  test("blankForm starts at least 15 minutes ahead on a half hour", () => {
    const now = new Date("2026-11-25T04:40:00Z");
    const f = blankForm(now, IST);
    assert.equal(f.time, "10:30"); // 04:55Z rounds up to 05:00Z = 10:30 IST
    assert.equal(f.durationMin, 30);
  });
});

describe("validation", () => {
  const ok = { title: "  Budget  ", startAt: "2026-12-04T09:30:00Z", durationMin: 45, timeZone: IST };
  test("create trims, nulls empties and defaults attendees", () => {
    const r = PlanCreate.parse({ ...ok, venue: "  ", callUrl: " https://x.test/a ", attendees: [{ name: " Asha ", email: "A@X.COM" }] });
    assert.equal(r.title, "Budget");
    assert.equal(r.venue, null);
    assert.equal(r.callUrl, "https://x.test/a");
    assert.equal(r.attendees[0].name, "Asha");
    assert.equal(r.attendees[0].email, "a@x.com");
    assert.deepEqual(PlanCreate.parse(ok).attendees, []);
  });
  test("create rejects bad input", () => {
    assert.equal(PlanCreate.safeParse({ ...ok, title: " " }).success, false);
    assert.equal(PlanCreate.safeParse({ ...ok, durationMin: 1 }).success, false);
    assert.equal(PlanCreate.safeParse({ ...ok, timeZone: "Mars/Base" }).success, false);
    assert.equal(PlanCreate.safeParse({ ...ok, agenda: "x".repeat(8001) }).success, false);
    assert.equal(PlanCreate.safeParse({ ...ok, callUrl: "ftp://x" }).success, false);
    assert.equal(PlanCreate.safeParse({ ...ok, attendees: Array.from({ length: 51 }, () => ({ name: "A" })) }).success, false);
  });
  test("patch needs a field; status can't be set to RECORDED", () => {
    assert.equal(PlanPatch.safeParse({}).success, false);
    assert.equal(PlanPatch.safeParse({ status: "RECORDED" }).success, false);
    assert.ok(PlanPatch.safeParse({ status: "CANCELLED" }).success);
    assert.equal(PlanPatch.parse({ venue: "" }).venue, null);
  });
  test("series and link bodies", () => {
    assert.equal(SeriesCreate.parse({ title: "Board" }).cadence, "NONE");
    assert.equal(SeriesCreate.safeParse({ title: "Board", cadence: "DAILY" }).success, false);
    assert.ok(LinkBody.safeParse({ meetingId: "abcdefghij0123456789" }).success);
    assert.equal(LinkBody.safeParse({ meetingId: "short" }).success, false);
  });
});

describe("text", () => {
  test("invite text has time in the host zone, place, people and agenda", () => {
    const t = inviteText(plan({ callUrl: "https://meet.example/x" }));
    assert.match(t, /Weekly review/);
    assert.match(t, /3:00 pm to 3:30 pm/);
    assert.match(t, /Where: Room 4/);
    assert.match(t, /Join: https:\/\/meet\.example\/x/);
    assert.match(t, /Asha Rao \(CFO\), Ben/);
    assert.match(t, /Agenda\n1\. Budget/);
  });
  test("AI block is empty without agenda and attendees, and names both otherwise", () => {
    assert.equal(planPromptBlock(null), "");
    assert.equal(planPromptBlock({ title: "x", attendees: [] }), "");
    const b = planPromptBlock({ title: "x", agenda: "1. Budget", attendees: [{ name: "Asha", designation: "CFO" }] });
    assert.match(b, /Asha \(CFO\)/);
    assert.match(b, /1\. Budget/);
    assert.match(b, /agenda item/);
  });
});

describe("lists", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  const at = (min: number, over: Partial<PlanDTO> = {}) => plan({ startAt: new Date(now.getTime() + min * 60_000).toISOString(), ...over });
  test("upcoming: within 14 days, not ended, not cancelled, sorted", () => {
    const list = [at(60 * 24 * 20), at(-120), at(300, { id: "b" }), at(30, { id: "a" }), at(10, { status: "CANCELLED" }), at(-10, { id: "now" })];
    assert.deepEqual(upcomingPlans(list, now).map((p) => p.id), ["now", "a", "b"]);
  });
  test("next up: -15 to +30 minutes, closest wins", () => {
    assert.equal(nextUpPlan([at(45), at(-20)], now), null);
    assert.equal(nextUpPlan([at(25, { id: "far" }), at(-5, { id: "near" })], now)?.id, "near");
    assert.equal(nextUpPlan([at(5, { status: "RECORDED" })], now), null);
  });
  test("record link carries the plan id and title", () => {
    assert.equal(recordHref({ id: "p 1", title: "A & B" }), "/?plan=p%201&title=A%20%26%20B");
  });
});

describe("plan ics", () => {
  test("attendees with quoted CN, location, no attendee without email", () => {
    const ics = buildIcs({
      uid: "plan-1@transcriber", start: new Date("2026-12-04T09:30:00Z"), end: new Date("2026-12-04T10:00:00Z"), title: "Review",
      organizerName: "me", organizerEmail: "me@example.com", location: "Room 4",
      attendees: [{ name: 'Asha, "CFO"; x', email: "asha@example.com" }, { name: "Eve", email: "e@x.com\r\nBEGIN:VEVENT" }],
    });
    assert.match(ics, /LOCATION:Room 4/);
    assert.match(ics, /ATTENDEE;CN="Asha,  CFO ; x";ROLE=REQ-PARTICIPANT:mailto:asha@example\.com/);
    assert.equal((ics.match(/^BEGIN:VEVENT/gm) ?? []).length, 1);
    assert.equal((ics.match(/ATTENDEE;/g) ?? []).length, 2);
  });
});
