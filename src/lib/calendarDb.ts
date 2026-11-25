import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isFlagOn } from "./flags";
import { DEFAULT_AVAILABILITY, isValidTimeZone, normalizeAvailability, type AvailabilityRange } from "./scheduling";
import { MAX_KEEP_AHEAD, missingOccurrences } from "./calendar";
import { attendeeRows } from "./planningDb";
import type { Cadence } from "./planning";

/** True when a calendar column isn't in the database yet: 6_calendar hasn't been applied. */
export function isCalendarMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const NO_STORE = { "Cache-Control": "no-store" };

export function calendarMissing(): Response {
  return Response.json({ error: "Calendar needs a database update" }, { status: 503, headers: NO_STORE });
}

/** Set when the owner has switched the calendar features off in Admin. */
export async function calendarPaused(): Promise<Response | null> {
  if (await isFlagOn("calendar")) return null;
  return Response.json({ error: "Calendar features are paused for now." }, { status: 503, headers: NO_STORE });
}

/* ---------- Busy time ---------- */

export interface BusyItem {
  startAt: Date;
  endAt: Date;
  title: string;
  kind: "booking" | "plan";
}

/** Longest planned meeting (10 hours): a plan starting earlier than this before `from` cannot reach into the window. */
const MAX_PLAN_MS = 600 * 60_000;

/**
 * The user's own busy time between `from` and `to`: CONFIRMED bookings plus PLANNED planned meetings
 * (not deleted, not cancelled, not recorded), each with its length. `excludePlanId` leaves one plan out
 * (the one being edited). Throws on database errors: callers decide what a failure means.
 */
export async function busyIntervals(userId: string, from: Date, to: Date, opts?: { excludePlanId?: string }): Promise<BusyItem[]> {
  const [bookings, plans] = await Promise.all([
    prisma.booking.findMany({
      where: { hostUserId: userId, status: "CONFIRMED", startAt: { lt: to }, endAt: { gt: from } },
      select: { startAt: true, endAt: true, guestName: true, eventType: { select: { title: true } } },
    }),
    prisma.plannedMeeting.findMany({
      where: {
        userId,
        deletedAt: null,
        status: "PLANNED",
        ...(opts?.excludePlanId ? { id: { not: opts.excludePlanId } } : {}),
        startAt: { gte: new Date(from.getTime() - MAX_PLAN_MS), lt: to },
      },
      select: { startAt: true, durationMin: true, title: true },
    }),
  ]);
  const out: BusyItem[] = bookings.map((b) => ({
    startAt: b.startAt,
    endAt: b.endAt,
    title: `${b.eventType.title} with ${b.guestName}`.slice(0, 200),
    kind: "booking" as const,
  }));
  for (const p of plans) {
    const endAt = new Date(p.startAt.getTime() + p.durationMin * 60_000);
    if (endAt > from) out.push({ startAt: p.startAt, endAt, title: p.title, kind: "plan" });
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * The host's planned meetings as extra busy blocks for the public booking page. Empty when the calendar
 * switch is off, the table is missing or anything fails, so booking behaves exactly as before.
 */
export async function plannedBusyForSlots(hostId: string, from: Date, to: Date): Promise<{ startAt: Date; endAt: Date }[]> {
  try {
    if (!(await isFlagOn("calendar"))) return [];
    const plans = await prisma.plannedMeeting.findMany({
      where: {
        userId: hostId,
        deletedAt: null,
        status: "PLANNED",
        startAt: { gte: new Date(from.getTime() - 86_400_000 - MAX_PLAN_MS), lt: new Date(to.getTime() + 86_400_000) },
      },
      select: { startAt: true, durationMin: true },
    });
    return plans.map((p) => ({ startAt: p.startAt, endAt: new Date(p.startAt.getTime() + p.durationMin * 60_000) }));
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Planned busy time error:", err);
    return [];
  }
}

/** Weekly working hours and zone of a user. Defaults (Mon to Fri, 10 to 5) when none are saved yet. */
export async function workingHoursOf(userId: string): Promise<{ timeZone: string | null; ranges: AvailabilityRange[] }> {
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
    prisma.availability.findMany({ where: { userId }, select: { weekday: true, startMin: true, endMin: true } }),
  ]);
  const tz = user?.timeZone && isValidTimeZone(user.timeZone) ? user.timeZone : null;
  return { timeZone: tz, ranges: rows.length ? normalizeAvailability(rows) : DEFAULT_AVAILABILITY };
}

/* ---------- Series: keep N ahead ---------- */

const ahead = new Map<string, number>();
const AHEAD_THROTTLE_MS = 30_000;

/**
 * Creates the missing future meetings of one series so `keepAhead` of them are planned. Idempotent: the unique
 * (seriesId, startAt) index turns a concurrent duplicate into "already exists" (P2002), which is ignored.
 * Returns how many were created. Throws only on unexpected database errors.
 */
export async function ensureAhead(userId: string, seriesId: string, nowMs = Date.now()): Promise<number> {
  const series = await prisma.meetingSeries.findFirst({
    where: { id: seriesId, userId, deletedAt: null },
    select: { id: true, cadence: true, keepAhead: true },
  });
  if (!series || series.keepAhead <= 0 || series.cadence === "NONE") return 0;
  const plans = await prisma.plannedMeeting.findMany({
    where: { userId, seriesId },
    orderBy: { startAt: "desc" },
    take: 400,
    select: {
      startAt: true, status: true, deletedAt: true, title: true, durationMin: true, timeZone: true, venue: true, callUrl: true,
      attendees: { select: { stakeholderId: true, name: true, email: true, designation: true, role: true } },
    },
  });
  const base = plans.find((p) => !p.deletedAt);
  if (!base) return 0;
  const futurePlanned = plans.filter((p) => !p.deletedAt && p.status === "PLANNED" && p.startAt.getTime() > nowMs).length;
  const starts = missingOccurrences({
    baseMs: base.startAt.getTime(),
    cadence: series.cadence as Cadence,
    timeZone: base.timeZone,
    nowMs,
    takenMs: plans.map((p) => p.startAt.getTime()),
    futurePlanned,
    keepAhead: Math.min(series.keepAhead, MAX_KEEP_AHEAD),
  });
  let created = 0;
  for (const ms of starts) {
    try {
      const row = await prisma.plannedMeeting.create({
        data: {
          userId, seriesId, title: base.title, startAt: new Date(ms), durationMin: base.durationMin, timeZone: base.timeZone,
          venue: base.venue, callUrl: base.callUrl,
        },
        select: { id: true },
      });
      if (base.attendees.length) await prisma.plannedAttendee.createMany({ data: attendeeRows(row.id, base.attendees) });
      created++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // someone else just created it
    }
  }
  return created;
}

/**
 * Runs ensureAhead for every series of the user that wants it. Never throws; skipped when the calendar switch
 * is off, the planning switch is off or the columns don't exist yet. Throttled per user.
 */
export async function ensureAheadForUser(userId: string, opts?: { seriesId?: string; force?: boolean }): Promise<void> {
  try {
    const now = Date.now();
    const key = `${userId}:${opts?.seriesId ?? "*"}`;
    if (!opts?.force && now - (ahead.get(key) ?? 0) < AHEAD_THROTTLE_MS) return;
    if (!(await isFlagOn("calendar")) || !(await isFlagOn("plannedMeetings"))) return;
    ahead.set(key, now);
    if (ahead.size > 2000) ahead.clear();
    const list = await prisma.meetingSeries.findMany({
      where: { userId, deletedAt: null, keepAhead: { gt: 0 }, ...(opts?.seriesId ? { id: opts.seriesId } : {}) },
      select: { id: true },
      take: 50,
    });
    for (const s of list) await ensureAhead(userId, s.id, now);
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Series keep-ahead error:", err);
  }
}

/* ---------- Plan change tracking ---------- */

/** Bumps a plan's invite SEQUENCE. Best effort: a missing column or switch leaves the plan as it was. */
export async function bumpSequence(planId: string): Promise<void> {
  try {
    if (!(await isFlagOn("calendar"))) return;
    await prisma.plannedMeeting.update({ where: { id: planId }, data: { icsSequence: { increment: 1 } }, select: { id: true } });
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Sequence bump error:", err);
  }
}

/** The plan's invite SEQUENCE, or null when unavailable (switch off, column missing). */
export async function sequenceOf(planId: string): Promise<number | null> {
  try {
    if (!(await isFlagOn("calendar"))) return null;
    const r = await prisma.plannedMeeting.findUnique({ where: { id: planId }, select: { icsSequence: true } });
    return r ? r.icsSequence : null;
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Sequence read error:", err);
    return null;
  }
}

/**
 * Saving a plan replaces its attendee rows, which would forget who was already emailed. Read the "invited at"
 * times (by email) before the replace and put them back after. Both are best effort and silent without 6_calendar.
 */
export async function snapshotInvited(planId: string): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  try {
    if (!(await isFlagOn("calendar"))) return out;
    const rows = await prisma.plannedAttendee.findMany({
      where: { plannedMeetingId: planId, invitedAt: { not: null } },
      select: { email: true, invitedAt: true },
    });
    for (const r of rows) if (r.email && r.invitedAt) out.set(r.email.toLowerCase(), r.invitedAt);
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Invited snapshot error:", err);
  }
  return out;
}

export async function restoreInvited(planId: string, invited: Map<string, Date>): Promise<void> {
  try {
    for (const [email, at] of invited) {
      await prisma.plannedAttendee.updateMany({ where: { plannedMeetingId: planId, email }, data: { invitedAt: at } });
    }
  } catch (err) {
    if (!isCalendarMissing(err)) console.error("Invited restore error:", err);
  }
}
