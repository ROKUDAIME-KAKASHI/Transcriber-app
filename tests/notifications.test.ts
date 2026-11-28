import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  badgeLabel, buildNotifications, followUpsToPlan, markRead, parseRead, relativeTime, unreadCount, unreadItems, whenPhrase,
  type NotifBooking, type NotifPlan,
} from "../src/lib/notifications.ts";

const NOW = Date.UTC(2026, 10, 28, 6, 0); // 11:30 in Kolkata
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const plan = (o: Partial<NotifPlan> & { id: string; startAt: string }): NotifPlan => ({
  title: o.id, durationMin: 30, status: "PLANNED", venue: null, callUrl: null, meetingId: null, bookingId: null, attendees: [], seriesId: null, ...o,
});
const booking = (o: Partial<NotifBooking> & { id: string; startAt: string }): NotifBooking => ({
  guestName: "Sam", guestEmail: "s@x.com", endAt: iso(Date.parse(o.startAt) + 30 * MIN), eventTitle: "Intro", meetingId: null, ...o,
});
const base = { nowMs: NOW, tz: "Asia/Kolkata", plans: [] as NotifPlan[], bookings: [] as NotifBooking[], tasks: null, today: "2026-11-28", reviews: [] };

describe("relative time and phrases", () => {
  test("relativeTime", () => {
    assert.equal(relativeTime(NOW + 8 * MIN, NOW), "in 8 min");
    assert.equal(relativeTime(NOW + 3 * HOUR, NOW), "in 3 h");
    assert.equal(relativeTime(NOW + 2 * DAY, NOW), "in 2 d");
    assert.equal(relativeTime(NOW - 5 * MIN, NOW), "5 min ago");
    assert.equal(relativeTime(NOW - 26 * HOUR, NOW), "1 d ago");
    assert.equal(relativeTime(NOW + 10_000, NOW), "just now");
  });

  test("whenPhrase says today, tomorrow or the date, in the user's zone", () => {
    assert.equal(whenPhrase(NOW + 2 * HOUR, NOW, "Asia/Kolkata"), "today 1:30 pm");
    assert.equal(whenPhrase(NOW + 20 * HOUR, NOW, "Asia/Kolkata"), "tomorrow 7:30 am");
    assert.match(whenPhrase(NOW + 3 * DAY, NOW, "Asia/Kolkata"), /Tue.*Dec/);
  });
});

describe("building the list", () => {
  test("meetings inside 24 hours are listed, soonest first; 10 minutes or less is 'soon' and links to Record", () => {
    const items = buildNotifications({
      ...base,
      plans: [
        plan({ id: "later", startAt: iso(NOW + 5 * HOUR) }),
        plan({ id: "soon", startAt: iso(NOW + 8 * MIN), title: "Standup" }),
        plan({ id: "far", startAt: iso(NOW + 30 * HOUR) }),
        plan({ id: "past", startAt: iso(NOW - HOUR) }),
        plan({ id: "off", startAt: iso(NOW + HOUR), status: "CANCELLED" }),
      ],
    });
    assert.deepEqual(items.map((i) => [i.kind, i.id]), [["soon", "soon:soon"], ["upcoming", "up:later"]]);
    assert.equal(items[0].text, "Starting soon: Standup");
    assert.match(items[0].href, /^\/\?plan=soon&title=Standup/);
    assert.equal(items[1].href, "/plan?id=later");
    assert.equal(items[1].atMs, NOW + 5 * HOUR);
  });

  test("a booking that has a plan is not listed twice; one without a plan is", () => {
    const items = buildNotifications({
      ...base,
      plans: [plan({ id: "p", startAt: iso(NOW + 2 * HOUR), bookingId: "b1" })],
      bookings: [booking({ id: "b1", startAt: iso(NOW + 2 * HOUR) }), booking({ id: "b2", startAt: iso(NOW + 4 * HOUR), guestName: "Ann" })],
    });
    assert.deepEqual(items.map((i) => i.id), ["up:p", "up:b-b2"]);
  });

  test("new bookings: only recent, not over, newest first", () => {
    const items = buildNotifications({
      ...base,
      bookings: [
        booking({ id: "old", startAt: iso(NOW + 5 * DAY), createdAt: iso(NOW - 4 * DAY) }),
        booking({ id: "n1", startAt: iso(NOW + 5 * DAY), createdAt: iso(NOW - 2 * HOUR), guestName: "Ann" }),
        booking({ id: "n2", startAt: iso(NOW + 6 * DAY), createdAt: iso(NOW - HOUR) }),
        booking({ id: "over", startAt: iso(NOW - 2 * DAY), createdAt: iso(NOW - 2 * DAY - HOUR) }),
        booking({ id: "nocreated", startAt: iso(NOW + 5 * DAY) }),
      ],
    });
    assert.deepEqual(items.map((i) => i.id), ["booking:n2", "booking:n1"]);
    assert.match(items[1].text, /^New booking: Ann, /);
    assert.equal(items[0].href, "/schedule?options=bookings");
  });

  test("task counts: overdue and due today, singular and plural, id changes with the count", () => {
    const a = buildNotifications({ ...base, tasks: { overdue: 1, dueToday: 3 } });
    assert.deepEqual(a.map((i) => i.text), ["1 task is overdue", "3 tasks are due today"]);
    const b = buildNotifications({ ...base, tasks: { overdue: 2, dueToday: 0 } });
    assert.notEqual(a[0].id, b[0].id);
    assert.deepEqual(buildNotifications({ ...base, tasks: { overdue: 0, dueToday: 0 } }), []);
    assert.deepEqual(buildNotifications({ ...base, tasks: null }), []);
  });

  test("follow-ups: recorded in the last week with nothing planned after it", () => {
    const plans: NotifPlan[] = [
      plan({ id: "rec1", status: "RECORDED", meetingId: "m1", startAt: iso(NOW - 2 * DAY), seriesId: "s1" }),
      plan({ id: "next1", startAt: iso(NOW + 5 * DAY), seriesId: "s1" }), // already planned
      plan({ id: "rec2", status: "RECORDED", meetingId: "m2", startAt: iso(NOW - 3 * DAY), title: "Solo" }),
      plan({ id: "rec3", status: "RECORDED", meetingId: "m3", startAt: iso(NOW - 10 * DAY) }), // too old
      plan({ id: "rec4", status: "RECORDED", meetingId: null, startAt: iso(NOW - DAY) }), // no recording
      plan({ id: "rec5", status: "RECORDED", meetingId: "m5", startAt: iso(NOW - DAY), title: "Weekly" }),
      plan({ id: "later5", startAt: iso(NOW + 6 * DAY), title: "Weekly" }), // same title, no series: counts as planned
    ];
    assert.deepEqual(followUpsToPlan(plans, NOW).map((p) => p.id), ["rec2"]);
    const items = buildNotifications({ ...base, plans });
    assert.deepEqual(items.map((i) => i.id), ["follow:rec2"]);
    assert.equal(items[0].href, "/plan?id=rec2");
  });

  test("minutes waiting for review", () => {
    const items = buildNotifications({
      ...base,
      reviews: [
        { meetingId: "m1", title: "Budget", count: 2, atMs: NOW - HOUR },
        { meetingId: "m2", title: "Empty", count: 0, atMs: NOW - HOUR },
        { meetingId: "m3", title: "Stale", count: 4, atMs: NOW - 9 * DAY },
      ],
    });
    assert.deepEqual(items.map((i) => i.text), ["2 action items to review: Budget"]);
    assert.equal(items[0].href, "/meeting?id=m1&tab=actions");
  });

  test("order: soon, new bookings, tasks, follow-ups, reviews", () => {
    const items = buildNotifications({
      ...base,
      plans: [plan({ id: "soon", startAt: iso(NOW + 5 * MIN) }), plan({ id: "rec", status: "RECORDED", meetingId: "m", startAt: iso(NOW - DAY) })],
      bookings: [booking({ id: "b", startAt: iso(NOW + 3 * DAY), createdAt: iso(NOW - HOUR) })],
      tasks: { overdue: 1, dueToday: 1 },
      reviews: [{ meetingId: "r", title: "R", count: 1, atMs: NOW - HOUR }],
    });
    assert.deepEqual(items.map((i) => i.kind), ["soon", "booking", "overdue", "dueToday", "followUp", "review"]);
  });
});

describe("unread logic", () => {
  const items = buildNotifications({ ...base, tasks: { overdue: 1, dueToday: 1 } });

  test("everything is unread at first; a bad or missing store means nothing is read", () => {
    assert.equal(unreadCount(items, parseRead(null)), 2);
    assert.equal(unreadCount(items, parseRead("not json")), 2);
    assert.deepEqual(parseRead("[1,2]"), {});
    assert.deepEqual(parseRead('{"a":1,"b":"x"}'), { a: 1 });
  });

  test("mark all read clears the badge; a changed item is unread again", () => {
    const read = markRead({}, items.map((i) => i.id), NOW);
    assert.equal(unreadCount(items, read), 0);
    const worse = buildNotifications({ ...base, tasks: { overdue: 4, dueToday: 1 } });
    assert.deepEqual(unreadItems(worse, read).map((i) => i.kind), ["overdue"]);
  });

  test("old entries are dropped and the map stays small", () => {
    const stale = { gone: NOW - 20 * DAY, kept: NOW - DAY };
    assert.deepEqual(Object.keys(markRead(stale, ["new"], NOW)).sort(), ["kept", "new"]);
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, NOW - i * 1000]));
    assert.equal(Object.keys(markRead(many, ["x"], NOW)).length, 300);
  });

  test("badge text", () => {
    assert.equal(badgeLabel(0), "");
    assert.equal(badgeLabel(4), "4");
    assert.equal(badgeLabel(12), "9+");
  });
});
