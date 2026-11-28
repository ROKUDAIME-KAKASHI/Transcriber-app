import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvents, clockLabel, dayStartMs, eventsOnDay, hourLabel, isYmd, layoutOverlaps, mergeById, nowPosition, replaceInWindow, planHrefAt, prefillFromParams,
  rangeFor, rangeTitle, segmentsForDay, shiftAnchor, slotMinutes, timeText, todayIn,
  type PlanLike,
} from "../src/lib/calendarView.ts";

const plan = (o: Partial<PlanLike> & { id: string; startAt: string }): PlanLike => ({
  title: "P", durationMin: 30, status: "PLANNED", venue: null, callUrl: null, meetingId: null, bookingId: null, attendees: [], ...o,
});

describe("range and week math", () => {
  test("week runs Monday to Sunday around the anchor", () => {
    const r = rangeFor("week", "2026-11-28", "UTC"); // a Saturday
    assert.equal(r.days[0], "2026-11-23");
    assert.equal(r.days[6], "2026-11-29");
    assert.equal(r.days.length, 7);
    assert.equal(r.toMs - r.fromMs, 7 * 86_400_000);
  });

  test("month shows whole weeks (4, 5 or 6 rows)", () => {
    const nov = rangeFor("month", "2026-11-15", "UTC");
    assert.equal(nov.days[0], "2026-10-26");
    assert.equal(nov.days.length, 42); // 1 Nov 2026 is a Sunday: six rows
    assert.equal(nov.days[41], "2026-12-06");
    const jan = rangeFor("month", "2026-01-10", "UTC"); // 1 Jan 2026 is a Thursday: five rows
    assert.equal(jan.days.length, 35);
    const aug = rangeFor("month", "2026-08-10", "UTC"); // 1 Aug 2026 is a Saturday: six rows
    assert.equal(aug.days.length, 42);
    assert.equal(aug.days[0], "2026-07-27");
    const feb = rangeFor("month", "2027-02-01", "UTC"); // 1 Feb 2027 is a Monday, 28 days: four rows
    assert.equal(feb.days.length, 28);
  });

  test("day is one day", () => {
    const r = rangeFor("day", "2026-11-28", "Asia/Kolkata");
    assert.deepEqual(r.days, ["2026-11-28"]);
    assert.equal(r.fromMs, Date.UTC(2026, 10, 27, 18, 30));
    assert.equal(r.toMs - r.fromMs, 86_400_000);
  });

  test("a day that has 23 hours is shorter, not shifted", () => {
    const r = rangeFor("day", "2026-03-08", "America/New_York");
    assert.equal(r.toMs - r.fromMs, 23 * 3_600_000);
  });

  test("back and forward by view", () => {
    assert.equal(shiftAnchor("day", "2026-11-30", 1), "2026-12-01");
    assert.equal(shiftAnchor("week", "2026-11-28", -1), "2026-11-21");
    assert.equal(shiftAnchor("month", "2026-12-15", 1), "2027-01-01");
    assert.equal(shiftAnchor("month", "2026-01-31", -1), "2025-12-01");
  });

  test("titles", () => {
    assert.equal(rangeTitle(rangeFor("month", "2026-11-28", "UTC")), "November 2026");
    assert.equal(rangeTitle(rangeFor("week", "2026-11-28", "UTC")), "23 – 29 Nov 2026");
    assert.equal(rangeTitle(rangeFor("week", "2026-12-02", "UTC")), "30 Nov – 6 Dec 2026");
    assert.equal(rangeTitle(rangeFor("week", "2026-12-31", "UTC")), "28 Dec 2026 – 3 Jan 2027");
    assert.match(rangeTitle(rangeFor("day", "2026-11-28", "UTC")), /^Sat,? 28 Nov 2026$/);
  });

  test("today and the day start follow the zone", () => {
    const t = Date.UTC(2026, 10, 28, 20, 0); // 01:30 on the 29th in Kolkata
    assert.equal(todayIn("UTC", t), "2026-11-28");
    assert.equal(todayIn("Asia/Kolkata", t), "2026-11-29");
    assert.equal(dayStartMs("2026-11-29", "Asia/Kolkata"), Date.UTC(2026, 10, 28, 18, 30));
    assert.deepEqual(nowPosition(t, "Asia/Kolkata"), { ymd: "2026-11-29", min: 90 });
  });

  test("helpers", () => {
    assert.equal(isYmd("2026-02-30"), false);
    assert.equal(isYmd("2026-11-28"), true);
    assert.equal(hourLabel(0), "12 am");
    assert.equal(hourLabel(13), "1 pm");
    assert.equal(timeText(570), "09:30");
    assert.equal(clockLabel(570), "9:30 am");
    assert.equal(clockLabel(0), "12:00 am");
    assert.equal(clockLabel(13 * 60 + 5), "1:05 pm");
  });
});

describe("overlap layout", () => {
  test("separate events each take the full width", () => {
    const l = layoutOverlaps([{ startMin: 60, endMin: 90 }, { startMin: 120, endMin: 150 }]);
    assert.deepEqual(l.map((x) => [x.col, x.cols]), [[0, 1], [0, 1]]);
  });

  test("two overlapping events sit side by side", () => {
    const l = layoutOverlaps([{ startMin: 60, endMin: 120 }, { startMin: 90, endMin: 150 }]);
    assert.deepEqual(l.map((x) => [x.col, x.cols]), [[0, 2], [1, 2]]);
  });

  test("a chain shares one cluster but reuses a free column", () => {
    const l = layoutOverlaps([
      { startMin: 0, endMin: 100 },
      { startMin: 50, endMin: 150 },
      { startMin: 110, endMin: 200 }, // fits under the first one again
    ]);
    assert.deepEqual(l.map((x) => [x.col, x.cols]), [[0, 2], [1, 2], [0, 2]]);
  });

  test("touching events do not overlap", () => {
    const l = layoutOverlaps([{ startMin: 0, endMin: 60 }, { startMin: 60, endMin: 120 }]);
    assert.deepEqual(l.map((x) => x.cols), [1, 1]);
  });

  test("three at once get three columns", () => {
    const l = layoutOverlaps([{ startMin: 0, endMin: 60 }, { startMin: 0, endMin: 60 }, { startMin: 10, endMin: 40 }]);
    assert.deepEqual(l.map((x) => x.cols), [3, 3, 3]);
    assert.deepEqual(l.map((x) => x.col).sort(), [0, 1, 2]);
  });
});

describe("events", () => {
  const tz = "Asia/Kolkata";
  const events = buildEvents({
    plans: [
      plan({ id: "a", startAt: "2026-11-28T04:30:00Z", durationMin: 60, title: "Standup" }), // 10:00-11:00 IST
      plan({ id: "c", startAt: "2026-11-28T05:00:00Z", status: "CANCELLED" }),
      plan({ id: "fromBooking", startAt: "2026-11-28T08:30:00Z", bookingId: "bk1", title: "Intro with Sam" }),
      plan({ id: "late", startAt: "2026-11-28T18:00:00Z", durationMin: 120 }), // 23:30 IST to 01:30 next day
    ],
    bookings: [
      { id: "bk1", guestName: "Sam", guestEmail: "s@x.com", startAt: "2026-11-28T08:30:00Z", endAt: "2026-11-28T09:00:00Z", eventTitle: "Intro", meetingId: null },
      { id: "bk2", guestName: "Ann", guestEmail: "a@x.com", startAt: "2026-11-29T05:00:00Z", endAt: "2026-11-29T05:30:00Z", eventTitle: "Chat", meetingId: "m2" },
    ],
    meetings: [
      { id: "m1", title: "Old call", createdAt: "2026-11-27T06:00:00Z", durationSec: 600 },
      { id: "m2", title: "Linked to booking", createdAt: "2026-11-29T05:00:00Z", durationSec: 900 },
      { id: "m3", title: "Gone", createdAt: "2026-11-27T06:00:00Z", durationSec: 600, deleted: 1 },
      { id: "m4", title: "", createdAt: "2026-11-26T06:00:00Z", durationSec: 0 },
    ],
  });

  test("plans from a booking show once, as Booked; cancelled plans and linked or deleted meetings are hidden", () => {
    assert.deepEqual(events.map((e) => e.key), ["meeting:m4", "meeting:m1", "plan:a", "plan:fromBooking", "plan:late", "booking:bk2"]);
    assert.equal(events.find((e) => e.key === "plan:fromBooking")?.kind, "booking");
    assert.equal(events.find((e) => e.key === "plan:a")?.kind, "plan");
    assert.equal(events.find((e) => e.key === "meeting:m1")?.kind, "recorded");
  });

  test("a recorded meeting gets at least 15 minutes and a default title", () => {
    const m4 = events.find((e) => e.key === "meeting:m4")!;
    assert.equal(m4.endMs - m4.startMs, 15 * 60_000);
    assert.equal(m4.title, "Untitled meeting");
  });

  test("segments are minutes from the start of the day in the user's zone", () => {
    const segs = segmentsForDay(events, "2026-11-28", tz);
    const a = segs.find((s) => s.event.key === "plan:a")!;
    assert.deepEqual([a.startMin, a.endMin], [600, 660]);
  });

  test("a meeting past midnight is on both days, clipped", () => {
    const d1 = segmentsForDay(events, "2026-11-28", tz).find((s) => s.event.key === "plan:late")!;
    const d2 = segmentsForDay(events, "2026-11-29", tz).find((s) => s.event.key === "plan:late")!;
    assert.deepEqual([d1.startMin, d1.endMin], [23 * 60 + 30, 1440]);
    assert.deepEqual([d2.startMin, d2.endMin], [0, 90]);
    assert.equal(eventsOnDay(events, "2026-11-30", tz).length, 0);
  });

  test("a very short event still gets a tappable height", () => {
    const e = buildEvents({ plans: [plan({ id: "x", startAt: "2026-11-28T04:30:00Z", durationMin: 5 })], bookings: [], meetings: [] });
    const s = segmentsForDay(e, "2026-11-28", tz)[0];
    assert.ok(s.endMin - s.startMin >= 25);
  });

  test("overlapping events in a day get columns", () => {
    const e = buildEvents({
      plans: [plan({ id: "1", startAt: "2026-11-28T04:30:00Z", durationMin: 60 }), plan({ id: "2", startAt: "2026-11-28T05:00:00Z", durationMin: 60 })],
      bookings: [], meetings: [],
    });
    assert.deepEqual(segmentsForDay(e, "2026-11-28", tz).map((s) => [s.col, s.cols]), [[0, 2], [1, 2]]);
  });
});

describe("empty slots and plan links", () => {
  test("a click snaps down to the half hour and stays inside the day", () => {
    assert.equal(slotMinutes(0, 48), 0);
    assert.equal(slotMinutes(48 * 9 + 30, 48), 9 * 60 + 30);
    assert.equal(slotMinutes(48 * 9 + 10, 48), 9 * 60);
    assert.equal(slotMinutes(48 * 24 + 100, 48), 1410);
    assert.equal(slotMinutes(-5, 48), 0);
  });

  test("plan link carries date, time and zone; the plan page reads it back", () => {
    const href = planHrefAt("2026-11-28", 570, "Asia/Kolkata");
    const q = new URL(href, "http://x").searchParams;
    assert.equal(q.get("new"), "1");
    assert.deepEqual(prefillFromParams((k) => q.get(k)), { date: "2026-11-28", time: "09:30", timeZone: "Asia/Kolkata" });
  });

  test("bad values are ignored", () => {
    const bad: Record<string, string> = { date: "nope", time: "25:00", tz: "Not/AZone" };
    assert.deepEqual(prefillFromParams((k) => bad[k] ?? null), {});
    const tzOnly: Record<string, string> = { date: "2026-11-28", tz: "UTC" };
    assert.deepEqual(prefillFromParams((k) => tzOnly[k] ?? null), { timeZone: "UTC" });
    assert.deepEqual(prefillFromParams(() => null), {});
  });
});

describe("offline copy", () => {
  test("merge keeps fresh rows, newest first, and caps the size", () => {
    const old = [{ id: "a", startAt: "2026-11-01T00:00:00Z", v: 1 }, { id: "b", startAt: "2026-11-02T00:00:00Z", v: 1 }];
    const fresh = [{ id: "a", startAt: "2026-11-01T00:00:00Z", v: 2 }, { id: "c", startAt: "2026-11-03T00:00:00Z", v: 2 }];
    const m = mergeById(old, fresh);
    assert.deepEqual(m.map((x) => [x.id, x.v]), [["c", 2], ["b", 1], ["a", 2]]);
    assert.equal(mergeById(old, fresh, 2).length, 2);
  });

  test("a fresh answer replaces its window, so a deleted row disappears, and keeps rows outside it", () => {
    const row = (id: string, startAt: string, v = 1) => ({ id, startAt, v });
    const old = [row("keep", "2026-10-01T00:00:00Z"), row("gone", "2026-11-10T00:00:00Z"), row("stay", "2026-11-12T00:00:00Z")];
    const fresh = [row("stay", "2026-11-12T00:00:00Z", 2), row("new", "2026-11-20T00:00:00Z", 2)];
    const r = replaceInWindow(old, fresh, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 30));
    assert.deepEqual(r.map((x) => x.id), ["new", "stay", "keep"]);
  });
});
