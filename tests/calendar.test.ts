import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conflictMessage, conflictsWith, findCommonSlots, formFieldsAt, icsMethodFor, inviteLabel, inviteSubject, mergeIntervals,
  missingOccurrences, needsSequenceBump, parseEmailList, validRange, workingIntervals, type WorkingHours,
} from "../src/lib/calendar.ts";
import { buildIcs, wallClockOf, zonedToUtc } from "../src/lib/scheduling.ts";

const NY = "America/New_York";
const IST = "Asia/Kolkata";
const H = 3_600_000;
const MIN = 60_000;
const utc = (s: string) => new Date(s).getTime();
const weekdays = (startMin: number, endMin: number) => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin, endMin }));

describe("mergeIntervals", () => {
  test("merges overlapping and touching, drops empty", () => {
    const r = mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 7 }, { start: 2, end: 2 }]);
    assert.deepEqual(r, [{ start: 1, end: 4 }, { start: 5, end: 8 }]);
  });
});

describe("workingIntervals", () => {
  test("Mon-Fri 10-17 in New York is 15:00-22:00 UTC in winter, 14:00-21:00 in summer", () => {
    const w: WorkingHours = { timeZone: NY, ranges: weekdays(600, 1020) };
    const winter = workingIntervals(w, utc("2026-01-12T00:00:00Z"), utc("2026-01-13T00:00:00Z"));
    assert.deepEqual(winter, [{ start: utc("2026-01-12T15:00:00Z"), end: utc("2026-01-12T22:00:00Z") }]);
    const summer = workingIntervals(w, utc("2026-07-13T00:00:00Z"), utc("2026-07-14T00:00:00Z"));
    assert.deepEqual(summer, [{ start: utc("2026-07-13T14:00:00Z"), end: utc("2026-07-13T21:00:00Z") }]);
  });

  test("a range across the spring-forward hour is one hour shorter in real time", () => {
    // Sunday 2026-03-08: 02:00 -> 03:00 skipped in New York. Midnight to 06:00 local is 5 real hours.
    const w: WorkingHours = { timeZone: NY, ranges: [{ weekday: 0, startMin: 0, endMin: 360 }] };
    const r = workingIntervals(w, utc("2026-03-08T00:00:00Z"), utc("2026-03-09T00:00:00Z"));
    assert.equal(r.length, 1);
    assert.equal(r[0].end - r[0].start, 5 * H);
    assert.equal(r[0].start, utc("2026-03-08T05:00:00Z"));
  });

  test("a range across the fall-back hour is one hour longer", () => {
    // Sunday 2026-11-01: 02:00 -> 01:00 repeated. Midnight to 06:00 local is 7 real hours.
    const w: WorkingHours = { timeZone: NY, ranges: [{ weekday: 0, startMin: 0, endMin: 360 }] };
    const r = workingIntervals(w, utc("2026-11-01T00:00:00Z"), utc("2026-11-02T00:00:00Z"));
    assert.equal(r.length, 1);
    assert.equal(r[0].end - r[0].start, 7 * H);
  });

  test("ends at midnight (1440) reaches the next local day", () => {
    const w: WorkingHours = { timeZone: IST, ranges: [{ weekday: 1, startMin: 1200, endMin: 1440 }] };
    const r = workingIntervals(w, utc("2026-01-12T00:00:00Z"), utc("2026-01-14T00:00:00Z"));
    assert.equal(r.length, 1);
    assert.equal(r[0].end - r[0].start, 4 * H);
  });
});

describe("findCommonSlots", () => {
  const wh: WorkingHours = { timeZone: IST, ranges: weekdays(600, 1020) }; // 10:00-17:00 IST
  // Monday 2026-01-12 04:30Z is 10:00 IST.
  const from = utc("2026-01-12T00:00:00Z");
  const to = utc("2026-01-19T00:00:00Z");

  test("one person, no busy time: earliest slots, two per day first, spread over days", () => {
    const slots = findCommonSlots({ people: [{ key: "me", busy: [], working: wh }], fallbackWorking: wh, durationMin: 30, fromMs: from, toMs: to, displayTz: IST });
    assert.equal(slots.length, 6);
    assert.equal(slots[0].startMs, utc("2026-01-12T04:30:00Z"));
    const days = new Set(slots.map((s) => wallClockOf(s.startMs, IST).d));
    assert.equal(days.size, 3);
    for (const s of slots) assert.equal(s.endMs - s.startMs, 30 * MIN);
  });

  test("busy time is avoided, on the 15 minute grid", () => {
    const busy = [{ start: utc("2026-01-12T04:30:00Z"), end: utc("2026-01-12T05:35:00Z") }];
    const slots = findCommonSlots({ people: [{ key: "me", busy, working: wh }], fallbackWorking: wh, durationMin: 30, fromMs: from, toMs: to, displayTz: IST, max: 1 });
    assert.equal(slots[0].startMs, utc("2026-01-12T05:45:00Z"));
    assert.equal(slots[0].startMs % (15 * MIN), 0);
  });

  test("everyone must be free: two people with different zones and hours", () => {
    const ny: WorkingHours = { timeZone: NY, ranges: weekdays(540, 1020) }; // 9-17 NY = 14:00-22:00Z in winter
    const me = { key: "me", busy: [], working: wh }; // 04:30-11:30Z
    const them = { key: "a@b.com", busy: [], working: ny };
    // No overlap between 04:30-11:30Z and 14:00-22:00Z.
    assert.deepEqual(findCommonSlots({ people: [me, them], fallbackWorking: wh, durationMin: 30, fromMs: from, toMs: to, displayTz: IST }), []);
    const wide: WorkingHours = { timeZone: IST, ranges: weekdays(600, 1380) }; // 10:00-23:00 IST = 04:30-17:30Z
    const slots = findCommonSlots({ people: [{ key: "me", busy: [], working: wide }, them], fallbackWorking: wide, durationMin: 60, fromMs: from, toMs: to, displayTz: IST, max: 1 });
    assert.equal(slots[0].startMs, utc("2026-01-12T14:00:00Z"));
  });

  test("a shared person with no hours uses the fallback hours", () => {
    const slots = findCommonSlots({ people: [{ key: "x@y.com", busy: [], working: null }], fallbackWorking: wh, durationMin: 30, fromMs: from, toMs: to, displayTz: IST, max: 1 });
    assert.equal(slots[0].startMs, utc("2026-01-12T04:30:00Z"));
  });

  test("a slot never runs past the end of working hours", () => {
    const only: WorkingHours = { timeZone: IST, ranges: [{ weekday: 1, startMin: 600, endMin: 660 }] }; // Monday 10-11 IST
    const slots = findCommonSlots({ people: [{ key: "me", busy: [], working: only }], fallbackWorking: only, durationMin: 45, fromMs: from, toMs: to, displayTz: IST });
    // 10:00-10:45 fits; 10:15-11:00 overlaps it, so only one suggestion remains.
    assert.deepEqual(slots.map((s) => s.startMs), [utc("2026-01-12T04:30:00Z")]);
  });

  test("DST: a US spring-forward week keeps 10:00 local as the first slot every weekday", () => {
    const ny: WorkingHours = { timeZone: NY, ranges: weekdays(600, 1020) };
    const f = utc("2026-03-05T00:00:00Z"); // Thursday before the change on Sunday 8 March
    const t = utc("2026-03-13T00:00:00Z");
    const slots = findCommonSlots({ people: [{ key: "me", busy: [], working: ny }], fallbackWorking: ny, durationMin: 60, fromMs: f, toMs: t, displayTz: NY, perDay: 1, max: 6 });
    assert.ok(slots.length >= 5);
    for (const s of slots) {
      const w = wallClockOf(s.startMs, NY);
      assert.equal(w.h, 10);
      assert.equal(w.min, 0);
    }
    // 10:00 EST = 15:00Z on 6 Mar, 10:00 EDT = 14:00Z on 9 Mar.
    assert.ok(slots.some((s) => s.startMs === utc("2026-03-06T15:00:00Z")));
    assert.ok(slots.some((s) => s.startMs === utc("2026-03-09T14:00:00Z")));
  });

  test("no people or zero length gives nothing", () => {
    assert.deepEqual(findCommonSlots({ people: [], fallbackWorking: wh, durationMin: 30, fromMs: from, toMs: to, displayTz: IST }), []);
    assert.deepEqual(findCommonSlots({ people: [{ key: "me", busy: [], working: wh }], fallbackWorking: wh, durationMin: 0, fromMs: from, toMs: to, displayTz: IST }), []);
  });
});

describe("formFieldsAt", () => {
  test("date and time in the zone", () => {
    assert.deepEqual(formFieldsAt(utc("2026-01-12T04:30:00Z"), IST), { date: "2026-01-12", time: "10:00" });
    assert.deepEqual(formFieldsAt(utc("2026-07-13T14:05:00Z"), NY), { date: "2026-07-13", time: "10:05" });
  });
});

describe("conflicts", () => {
  const blocks = [
    { startMs: utc("2026-01-12T09:30:00Z"), endMs: utc("2026-01-12T10:30:00Z"), title: "Weekly review" },
    { startMs: utc("2026-01-12T11:00:00Z"), endMs: utc("2026-01-12T12:00:00Z"), title: "Budget" },
  ];
  test("overlap, touching is not a conflict", () => {
    assert.equal(conflictsWith(blocks, utc("2026-01-12T10:00:00Z"), utc("2026-01-12T10:30:00Z")).length, 1);
    assert.equal(conflictsWith(blocks, utc("2026-01-12T10:30:00Z"), utc("2026-01-12T11:00:00Z")).length, 0);
    assert.equal(conflictsWith(blocks, utc("2026-01-12T09:00:00Z"), utc("2026-01-12T12:00:00Z")).length, 2);
  });
  test("message names the meeting and its time", () => {
    assert.equal(conflictMessage([], IST), null);
    const one = conflictMessage([blocks[0]], "UTC");
    assert.equal(one, "You already have Weekly review at 9:30 am");
    assert.equal(conflictMessage(blocks, "UTC"), "You already have Weekly review at 9:30 am and 1 more");
  });
});

describe("request validation", () => {
  test("parseEmailList", () => {
    assert.deepEqual(parseEmailList("A@b.com, a@b.com ,not-an-email,c@d.org"), ["a@b.com", "c@d.org"]);
    assert.deepEqual(parseEmailList(null), []);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(",");
    assert.equal(parseEmailList(eleven), null);
    assert.equal(parseEmailList(eleven, 11)?.length, 11);
  });
  test("validRange", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    assert.equal(validRange(a, new Date("2026-01-10T00:00:00Z")), null);
    assert.ok(validRange(a, new Date("2026-01-20T00:00:00Z")));
    assert.ok(validRange(a, a));
    assert.ok(validRange(new Date("x"), a));
  });
});

describe("missingOccurrences", () => {
  const base = utc("2026-01-05T09:30:00Z"); // Monday, 10:00 IST is 04:30Z; any time works
  const now = utc("2026-01-06T00:00:00Z");
  test("weekly: keeps N future plans", () => {
    const r = missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [base], futurePlanned: 0, keepAhead: 4 });
    assert.equal(r.length, 4);
    assert.equal(r[0], utc("2026-01-12T09:30:00Z"));
    assert.equal(r[3], utc("2026-02-02T09:30:00Z"));
  });
  test("counts plans that already exist, creates only the rest", () => {
    const r = missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [base, utc("2026-01-12T09:30:00Z")], futurePlanned: 1, keepAhead: 2 });
    assert.deepEqual(r, [utc("2026-01-19T09:30:00Z")]);
  });
  test("a cancelled occurrence stays cancelled and the series reaches one further", () => {
    const cancelled = utc("2026-01-12T09:30:00Z");
    const r = missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [base, cancelled], futurePlanned: 0, keepAhead: 2 });
    assert.deepEqual(r, [utc("2026-01-19T09:30:00Z"), utc("2026-01-26T09:30:00Z")]);
  });
  test("idempotent: nothing missing once keepAhead is met", () => {
    const r = missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 4, keepAhead: 4 });
    assert.deepEqual(r, []);
  });
  test("off (0), NONE cadence and a past base", () => {
    assert.deepEqual(missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 0, keepAhead: 0 }), []);
    assert.deepEqual(missingOccurrences({ baseMs: base, cadence: "NONE", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 0, keepAhead: 4 }), []);
    const late = utc("2026-03-02T00:00:00Z");
    const r = missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: late, takenMs: [], futurePlanned: 0, keepAhead: 2 });
    assert.ok(r.every((t) => t > late));
    assert.equal(r.length, 2);
  });
  test("biweekly and monthly follow the cadence; capped at 8", () => {
    const bi = missingOccurrences({ baseMs: base, cadence: "BIWEEKLY", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 0, keepAhead: 2 });
    assert.deepEqual(bi, [utc("2026-01-19T09:30:00Z"), utc("2026-02-02T09:30:00Z")]);
    const mo = missingOccurrences({ baseMs: base, cadence: "MONTHLY", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 0, keepAhead: 2 });
    assert.deepEqual(mo, [utc("2026-02-02T09:30:00Z"), utc("2026-03-02T09:30:00Z")]);
    assert.equal(missingOccurrences({ baseMs: base, cadence: "WEEKLY", timeZone: "UTC", nowMs: now, takenMs: [], futurePlanned: 0, keepAhead: 50 }).length, 8);
  });
  test("DST: weekly in New York keeps the local time across the change", () => {
    const b = zonedToUtc({ y: 2026, m: 3, d: 2, h: 10, min: 0 }, NY) as number;
    const r = missingOccurrences({ baseMs: b, cadence: "WEEKLY", timeZone: NY, nowMs: b, takenMs: [b], futurePlanned: 0, keepAhead: 2 });
    for (const t of r) assert.equal(wallClockOf(t, NY).h, 10);
    assert.equal(r[1], utc("2026-03-16T14:00:00Z")); // 10:00 EDT
  });
});

describe("invites", () => {
  test("icsMethodFor", () => {
    assert.equal(icsMethodFor("PLANNED", 2), "REQUEST");
    assert.equal(icsMethodFor("CANCELLED", 2), "CANCEL");
    assert.equal(icsMethodFor("PLANNED", 0), "PUBLISH");
    assert.equal(icsMethodFor("CANCELLED", 0), "PUBLISH");
  });

  test("needsSequenceBump: only time, length, place, link, title or status", () => {
    const before = { title: "A", startAt: new Date("2026-01-12T09:00:00Z"), durationMin: 30, venue: null, callUrl: null, status: "PLANNED" };
    assert.equal(needsSequenceBump(before, {}), false);
    assert.equal(needsSequenceBump(before, { startAt: new Date("2026-01-12T09:00:00Z"), venue: null, callUrl: null, title: "A" }), false);
    assert.equal(needsSequenceBump(before, { startAt: new Date("2026-01-12T10:00:00Z") }), true);
    assert.equal(needsSequenceBump(before, { durationMin: 45 }), true);
    assert.equal(needsSequenceBump(before, { venue: "Boardroom" }), true);
    assert.equal(needsSequenceBump(before, { callUrl: "https://meet.example.com/x" }), true);
    assert.equal(needsSequenceBump(before, { title: "B" }), true);
    assert.equal(needsSequenceBump(before, { status: "CANCELLED" }), true);
    assert.equal(needsSequenceBump(before, { status: "PLANNED" }), false);
  });

  test("inviteSubject and inviteLabel", () => {
    assert.equal(inviteSubject("Weekly\nreview", "2026-01-12T09:30:00Z", "UTC", "invite"), "Invitation: Weekly review · Mon 12 Jan, 9:30 am");
    assert.ok(inviteSubject("X", "2026-01-12T09:30:00Z", "UTC", "update").startsWith("Updated invitation: X"));
    assert.ok(inviteSubject("X", "2026-01-12T09:30:00Z", "UTC", "cancel").startsWith("Cancelled: X"));
    assert.equal(inviteLabel("PLANNED", false), "Send invites");
    assert.equal(inviteLabel("PLANNED", true), "Send update");
    assert.equal(inviteLabel("CANCELLED", true), "Send cancellation");
    assert.equal(inviteLabel("CANCELLED", false), null);
    assert.equal(inviteLabel("RECORDED", true), null);
  });

  const base = {
    uid: "plan-1@transcriber", start: new Date("2026-01-12T09:30:00Z"), end: new Date("2026-01-12T10:00:00Z"), title: "Review",
    organizerName: "asha", organizerEmail: "asha@example.com", now: new Date("2026-01-01T00:00:00Z"),
  };

  test("buildIcs without invite options is unchanged (PUBLISH, no SEQUENCE, no RSVP)", () => {
    const ics = buildIcs({ ...base, attendees: [{ name: "Ravi", email: "ravi@example.com" }] });
    assert.match(ics, /METHOD:PUBLISH/);
    assert.doesNotMatch(ics, /SEQUENCE/);
    assert.doesNotMatch(ics, /RSVP/);
    assert.match(ics, /STATUS:CONFIRMED/);
  });

  test("REQUEST carries organizer, RSVP attendees, stable UID and SEQUENCE", () => {
    const ics = buildIcs({ ...base, attendees: [{ name: "Ravi", email: "ravi@example.com" }], method: "REQUEST", sequence: 2, rsvp: true }).split("\r\n ").join("");
    assert.match(ics, /METHOD:REQUEST/);
    assert.match(ics, /UID:plan-1@transcriber/);
    assert.match(ics, /SEQUENCE:2/);
    assert.match(ics, /ORGANIZER;CN="asha":mailto:asha@example.com/);
    assert.match(ics, /ATTENDEE;CN="Ravi";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ravi@example.com/);
    assert.match(ics, /STATUS:CONFIRMED/);
  });

  test("CANCEL is METHOD:CANCEL with STATUS:CANCELLED and the same UID", () => {
    const ics = buildIcs({ ...base, attendees: [{ name: "Ravi", email: "ravi@example.com" }], method: "CANCEL", sequence: 3, cancelled: true });
    assert.match(ics, /METHOD:CANCEL/);
    assert.match(ics, /STATUS:CANCELLED/);
    assert.match(ics, /SEQUENCE:3/);
    assert.match(ics, /UID:plan-1@transcriber/);
    assert.doesNotMatch(ics, /RSVP/);
  });
});
