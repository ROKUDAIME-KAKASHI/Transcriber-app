import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyLengths, availabilityFromSimple, handleWithDigits, lengthsFromEvents, simpleHoursFromAvailability, suggestHandle,
  DEFAULT_OPTIONS, type EventLike,
} from "../src/lib/scheduleSimple.ts";
import { validateHandle } from "../src/lib/scheduling.ts";

const ev = (over: Partial<EventLike>): EventLike => ({
  id: "e1", slug: "30min", title: "30 min meeting", durationMin: 30, bufferMin: 0, minNoticeMin: 120, maxDaysAhead: 30,
  active: true, description: null, ...over,
});

describe("suggestHandle", () => {
  test("lowercases and sanitises the email local part", () => {
    assert.equal(suggestHandle("Rahul.Sharma+work@Example.com"), "rahul-sharma-work");
  });
  test("always valid or empty", () => {
    for (const e of ["a@x.com", "ab@x.com", "admin@x.com", "--@x.com", "", undefined, "x".repeat(80) + "@y.com", "बी@x.com"]) {
      const h = suggestHandle(e);
      assert.ok(h === "" || validateHandle(h).ok, `${e} -> ${h}`);
    }
  });
  test("pads short and reserved names", () => {
    assert.ok(suggestHandle("ab@x.com").length >= 3);
    assert.equal(validateHandle(suggestHandle("admin@x.com")).ok, true);
  });
});

describe("handleWithDigits", () => {
  test("appends digits within 30 chars and stays valid", () => {
    const long = "a".repeat(30);
    for (let a = 0; a < 5; a++) {
      const h = handleWithDigits(long, a);
      assert.ok(h.length <= 30);
      assert.equal(validateHandle(h).ok, true);
    }
    assert.equal(handleWithDigits("rahul", 0, () => 0.5), "rahul55");
  });
});

describe("simple hours", () => {
  test("default week round-trips", () => {
    const av = availabilityFromSimple({ days: [1, 2, 3, 4, 5], startMin: 600, endMin: 1020 });
    assert.equal(av.length, 5);
    assert.deepEqual(simpleHoursFromAvailability(av), { days: [1, 2, 3, 4, 5], startMin: 600, endMin: 1020 });
  });
  test("Sunday sorts last", () => {
    const av = availabilityFromSimple({ days: [0, 6, 1], startMin: 540, endMin: 600 });
    assert.deepEqual(av.map((r) => r.weekday), [1, 6, 0]);
  });
  test("different ranges or two ranges a day are custom", () => {
    assert.equal(simpleHoursFromAvailability([{ weekday: 1, startMin: 600, endMin: 700 }, { weekday: 2, startMin: 600, endMin: 800 }]), null);
    assert.equal(simpleHoursFromAvailability([{ weekday: 1, startMin: 600, endMin: 700 }, { weekday: 1, startMin: 800, endMin: 900 }]), null);
  });
  test("empty availability is no days with the default range", () => {
    assert.deepEqual(simpleHoursFromAvailability([]), { days: [], startMin: 600, endMin: 1020 });
  });
});

describe("meeting lengths", () => {
  test("chips come from active events", () => {
    assert.deepEqual(lengthsFromEvents([ev({}), ev({ id: "e2", slug: "60min", durationMin: 60, active: false })]), [30]);
  });
  test("selecting creates events, unselecting deactivates and never drops", () => {
    const out = applyLengths([ev({}), ev({ id: "e2", slug: "weird", title: "Chat", durationMin: 20 })], [15, 30], DEFAULT_OPTIONS);
    const by = Object.fromEntries(out.map((e) => [e.slug, e]));
    assert.equal(by["15min"].id, null);
    assert.equal(by["15min"].title, "15 min meeting");
    assert.equal(by["15min"].active, true);
    assert.equal(by["30min"].id, "e1");
    assert.equal(by["30min"].active, true);
    assert.equal(by["weird"].active, false);
    assert.equal(out.length, 3);
    const off = applyLengths([ev({})], [60], DEFAULT_OPTIONS);
    assert.equal(off.find((e) => e.slug === "30min")?.active, false);
    assert.equal(off.find((e) => e.slug === "60min")?.active, true);
  });
  test("applies the shared options and keeps at least one event", () => {
    const out = applyLengths([ev({})], [], { bufferMin: 10, minNoticeMin: 60, maxDaysAhead: 14 });
    assert.equal(out.length, 1);
    assert.equal(out[0].bufferMin, 10);
    assert.equal(out[0].maxDaysAhead, 14);
  });
});

import { availabilityFromWeek, defaultWeek, weekFromAvailability, weekProblem } from "../src/lib/scheduleSimple.ts";

test("weekFromAvailability gives seven rows with different hours per day, and round-trips", () => {
  const av = [
    { weekday: 1, startMin: 9 * 60, endMin: 12 * 60 },
    { weekday: 3, startMin: 13 * 60, endMin: 18 * 60 },
  ];
  const rows = weekFromAvailability(av)!;
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.filter((r) => r.on).map((r) => r.n), [1, 3]);
  assert.deepEqual(availabilityFromWeek(rows), av);
});

test("weekFromAvailability refuses two ranges on one day", () => {
  assert.equal(weekFromAvailability([{ weekday: 1, startMin: 540, endMin: 600 }, { weekday: 1, startMin: 660, endMin: 720 }]), null);
});

test("weekProblem names the first bad day", () => {
  assert.equal(weekProblem(defaultWeek()), null);
  assert.equal(weekProblem(defaultWeek().map((r) => ({ ...r, on: false }))), "Pick at least one day people can book.");
  const rows = defaultWeek().map((r) => (r.n === 2 ? { ...r, startMin: 900, endMin: 600 } : r));
  assert.equal(weekProblem(rows), "Tuesday: the end time must be after the start time.");
});
