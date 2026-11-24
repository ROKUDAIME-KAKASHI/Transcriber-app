import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildIcs, dayKey, generateSlots, googleCalendarUrl, isSlotAvailable, normalizeAvailability,
  validateHandle, zonedToUtc, type SlotParams,
} from "../src/lib/scheduling.ts";

const base = (over: Partial<SlotParams> = {}): SlotParams => ({
  availability: [{ weekday: 1, startMin: 600, endMin: 720 }], // Mondays 10:00-12:00
  timeZone: "UTC",
  durationMin: 30,
  bufferMin: 0,
  minNoticeMin: 0,
  maxDaysAhead: 60,
  bookings: [],
  from: new Date("2026-11-30T00:00:00Z"), // Monday
  to: new Date("2026-12-01T00:00:00Z"),
  now: new Date("2026-11-24T00:00:00Z"),
  ...over,
});

describe("generateSlots", () => {
  test("steps by duration inside the range", () => {
    assert.deepEqual(generateSlots(base()), [
      "2026-11-30T10:00:00.000Z", "2026-11-30T10:30:00.000Z", "2026-11-30T11:00:00.000Z", "2026-11-30T11:30:00.000Z",
    ]);
  });
  test("a slot never runs past the end of the range", () => {
    const s = generateSlots(base({ durationMin: 45 }));
    assert.deepEqual(s, ["2026-11-30T10:00:00.000Z", "2026-11-30T10:45:00.000Z"]);
  });
  test("other weekdays have no slots", () => {
    assert.deepEqual(generateSlots(base({ from: new Date("2026-12-01T00:00:00Z"), to: new Date("2026-12-02T00:00:00Z") })), []);
  });
  test("host time zone shifts the UTC times", () => {
    const s = generateSlots(base({ timeZone: "Asia/Kolkata" })); // UTC+5:30
    assert.equal(s[0], "2026-11-30T04:30:00.000Z");
  });
  test("confirmed bookings are removed", () => {
    const s = generateSlots(base({ bookings: [{ startAt: "2026-11-30T10:30:00Z", endAt: "2026-11-30T11:00:00Z" }] }));
    assert.deepEqual(s, ["2026-11-30T10:00:00.000Z", "2026-11-30T11:00:00.000Z", "2026-11-30T11:30:00.000Z"]);
  });
  test("buffer pads both sides of a booking", () => {
    const s = generateSlots(base({ bufferMin: 15, bookings: [{ startAt: "2026-11-30T10:30:00Z", endAt: "2026-11-30T11:00:00Z" }] }));
    assert.deepEqual(s, ["2026-11-30T11:30:00.000Z"]);
  });
  test("minimum notice", () => {
    const s = generateSlots(base({ now: new Date("2026-11-30T09:45:00Z"), minNoticeMin: 60 }));
    assert.deepEqual(s, ["2026-11-30T11:00:00.000Z", "2026-11-30T11:30:00.000Z"]);
  });
  test("max days ahead", () => {
    assert.deepEqual(generateSlots(base({ maxDaysAhead: 3 })), []);
  });
  test("past slots are never offered", () => {
    assert.deepEqual(generateSlots(base({ now: new Date("2026-12-05T00:00:00Z") })), []);
  });
  test("overlapping ranges don't duplicate slots", () => {
    const s = generateSlots(base({ availability: [{ weekday: 1, startMin: 600, endMin: 660 }, { weekday: 1, startMin: 630, endMin: 720 }] }));
    assert.equal(new Set(s).size, s.length);
  });
  test("midnight-crossing offsets pick the right host day", () => {
    // Auckland is UTC+13 in December: Monday 10:00 local is Sunday 21:00 UTC.
    const s = generateSlots(base({ timeZone: "Pacific/Auckland", from: new Date("2026-11-29T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") }));
    assert.equal(s[0], "2026-11-29T21:00:00.000Z");
  });
});

describe("daylight saving", () => {
  test("a wall time in the spring-forward gap does not exist", () => {
    // US spring forward 2027-03-14: 02:30 does not exist in New York.
    assert.equal(zonedToUtc({ y: 2027, m: 3, d: 14, h: 2, min: 30 }, "America/New_York"), null);
  });
  test("offsets differ across the change", () => {
    assert.equal(new Date(zonedToUtc({ y: 2027, m: 3, d: 13, h: 10, min: 0 }, "America/New_York")!).toISOString(), "2027-03-13T15:00:00.000Z");
    assert.equal(new Date(zonedToUtc({ y: 2027, m: 3, d: 15, h: 10, min: 0 }, "America/New_York")!).toISOString(), "2027-03-15T14:00:00.000Z");
  });
  test("a repeated fall-back time resolves to the earlier instant", () => {
    // US fall back 2026-11-01: 01:30 happens twice; the first is EDT (UTC-4) = 05:30Z.
    assert.equal(new Date(zonedToUtc({ y: 2026, m: 11, d: 1, h: 1, min: 30 }, "America/New_York")!).toISOString(), "2026-11-01T05:30:00.000Z");
  });
  test("10:00 local stays 10:00 local on both sides of the change", () => {
    const s = generateSlots(base({
      timeZone: "America/New_York",
      availability: [1, 0].map((weekday) => ({ weekday, startMin: 600, endMin: 630 })),
      from: new Date("2027-03-12T00:00:00Z"), to: new Date("2027-03-17T00:00:00Z"), now: new Date("2027-03-01T00:00:00Z"),
    }));
    assert.deepEqual(s, ["2027-03-14T14:00:00.000Z", "2027-03-15T14:00:00.000Z"]);
  });
  test("dayKey uses the zone", () => {
    assert.equal(dayKey("2026-11-30T23:00:00Z", "Asia/Kolkata"), "2026-12-01");
  });
});

describe("isSlotAvailable", () => {
  const { from: _f, to: _t, ...rest } = base();
  void _f; void _t;
  test("accepts a listed slot", () => assert.ok(isSlotAvailable(new Date("2026-11-30T10:30:00Z"), rest)));
  test("rejects an off-grid time", () => assert.ok(!isSlotAvailable(new Date("2026-11-30T10:15:00Z"), rest)));
  test("rejects a booked slot", () => {
    assert.ok(!isSlotAvailable(new Date("2026-11-30T10:30:00Z"), { ...rest, bookings: [{ startAt: "2026-11-30T10:30:00Z", endAt: "2026-11-30T11:00:00Z" }] }));
  });
  test("rejects a past slot", () => assert.ok(!isSlotAvailable(new Date("2026-11-23T10:00:00Z"), rest)));
});

describe("handles and availability", () => {
  test("valid handle is lowercased", () => assert.deepEqual(validateHandle(" Asha-J "), { ok: true, handle: "asha-j" }));
  for (const bad of ["ab", "has space", "a".repeat(31), "-lead", "trail-", "under_score", "api", "book", "confirmed"]) {
    test(`rejects ${bad}`, () => assert.equal(validateHandle(bad).ok, false));
  }
  test("normalizeAvailability merges overlaps and sorts", () => {
    const out = normalizeAvailability([
      { weekday: 2, startMin: 780, endMin: 900 },
      { weekday: 2, startMin: 600, endMin: 720 },
      { weekday: 2, startMin: 700, endMin: 800 },
    ]);
    assert.deepEqual(out, [{ weekday: 2, startMin: 600, endMin: 900 }]);
  });
});

describe("calendar output", () => {
  const input = {
    uid: "b1@transcriber", start: new Date("2026-11-30T10:00:00Z"), end: new Date("2026-11-30T10:30:00Z"),
    title: "30 min meeting, with Asha", description: "Line one\nLine; two",
    organizerName: "asha", organizerEmail: "noreply@example.com", attendeeName: "Ravi", attendeeEmail: "ravi@example.com",
    now: new Date("2026-11-24T00:00:00Z"),
  };
  test("ics has UTC times, UID, METHOD and escaped text", () => {
    const ics = buildIcs(input);
    assert.match(ics, /METHOD:PUBLISH\r\n/);
    assert.match(ics, /UID:b1@transcriber\r\n/);
    assert.match(ics, /DTSTART:20261130T100000Z\r\n/);
    assert.match(ics, /DTEND:20261130T103000Z\r\n/);
    assert.ok(ics.includes("SUMMARY:30 min meeting\\, with Asha" + "\r\n"));
    assert.ok(ics.includes("DESCRIPTION:Line one\\nLine\\; two"));
    assert.match(ics, /ORGANIZER;CN=asha:mailto:/);
    assert.match(ics, /ATTENDEE;CN=Ravi;/);
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  });
  test("long lines fold at 75 bytes", () => {
    const ics = buildIcs({ ...input, description: "x".repeat(300) });
    for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75);
  });
  test("google link carries the UTC window", () => {
    const u = new URL(googleCalendarUrl({ title: "Hi", start: input.start, end: input.end }));
    assert.equal(u.searchParams.get("dates"), "20261130T100000Z/20261130T103000Z");
    assert.equal(u.searchParams.get("action"), "TEMPLATE");
  });
});
