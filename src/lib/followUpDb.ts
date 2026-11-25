import { prisma } from "./prisma";
import { isFlagOn } from "./flags";
import { withLive } from "./actionItemHistory";
import { isUniqueViolation } from "./calendarDb";
import { resolveOwners, withOwnerLink } from "./trackerPlusDb";
import { NO_STORE, PLAN_SELECT, attendeeRows, toPlanDTO } from "./planningDb";
import { isValidTimeZone } from "./scheduling";
import { carriedCount, carriedHeading, carryPoints, chooseNextStart, dayInZone, mergeCarryOver } from "./followUp";
import type { AgendaItem } from "./followUpAgenda";
import type { Cadence, PlanDTO } from "./planning";

/** Server side of "Plan next meeting" (Phase 17). Routes call planFollowUp and turn its result into a response. */

export async function followUpPaused(): Promise<Response | null> {
  if (await isFlagOn("followUpPlanning")) return null;
  return Response.json({ error: "Planning the next meeting is paused for now. Please check back later." }, { status: 503, headers: NO_STORE });
}

export interface FollowUpSource {
  title: string;
  startAt: Date;
  durationMin: number;
  timeZone: string;
  venue: string | null;
  callUrl: string | null;
  seriesId: string | null;
  attendees: { stakeholderId: string | null; name: string; email: string | null; designation: string | null; role: string | null }[];
  /** The recording whose tasks are carried. */
  meetingId: string;
}

export type FollowUpResult =
  | { ok: true; plan: PlanDTO; existing: boolean; carried: number; added: number }
  | { ok: false; status: number; error: string };

const TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Body of both POST routes: the caller's local day (for "overdue") and zone (when the meeting had no plan). */
export function readBody(raw: unknown): { today: string; timeZone: string | null } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const today = typeof o.today === "string" && TODAY_RE.test(o.today) ? o.today : new Date().toISOString().slice(0, 10);
  const tz = typeof o.timeZone === "string" && o.timeZone.length <= 64 && isValidTimeZone(o.timeZone) ? o.timeZone : null;
  return { today, timeZone: tz };
}

/** Meeting ids whose tasks feed the agenda: the source recording plus every earlier recorded meeting of its series. */
export async function sourceMeetingIds(userId: string, src: { meetingId: string; seriesId: string | null; startAt: Date }): Promise<string[]> {
  const ids = new Set<string>([src.meetingId]);
  if (src.seriesId) {
    const earlier = await prisma.plannedMeeting.findMany({
      where: { userId, seriesId: src.seriesId, deletedAt: null, meetingId: { not: null }, startAt: { lte: src.startAt } },
      orderBy: { startAt: "desc" },
      take: 60,
      select: { meetingId: true },
    });
    for (const e of earlier) if (e.meetingId) ids.add(e.meetingId);
  }
  return [...ids];
}

/** The unfinished, non-deleted tasks of those meetings, owners resolved from People when linked. */
async function openTasks(userId: string, meetingIds: string[]): Promise<AgendaItem[]> {
  const { rows, linked } = await withOwnerLink(async (link) => ({
    linked: link,
    rows: await withLive((live) =>
      prisma.actionItem.findMany({
        where: { userId, meetingId: { in: meetingIds }, status: { not: "DONE" }, ...live },
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          task: true, owner: true, deadlineText: true, dueDate: true, status: true,
          ...(link ? { ownerStakeholderId: true } : {}),
        },
      })
    ),
  }));
  const resolved = linked ? await resolveOwners(userId, rows as (typeof rows[number] & { ownerStakeholderId?: string | null })[]) : rows;
  return resolved.map((r) => ({
    task: r.task,
    owner: r.owner,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    deadlineText: r.deadlineText,
    status: (r.status === "IN_PROGRESS" || r.status === "BLOCKED" || r.status === "DONE" ? r.status : "NOT_STARTED") as AgendaItem["status"],
  }));
}

/**
 * Creates (or returns) the next planned meeting after `src` and fills its agenda with the carried tasks.
 * Asking twice gives the same plan and the same agenda. Throws on unexpected database errors; the routes map
 * the known ones (missing tables).
 */
export async function planFollowUp(userId: string, src: FollowUpSource, opts: { today: string; nowMs?: number }): Promise<FollowUpResult> {
  const nowMs = opts.nowMs ?? Date.now();
  let cadence: Cadence | null = null;
  let latestStartMs = src.startAt.getTime();
  let plannedStartsMs: number[] = [];
  if (src.seriesId) {
    const series = await prisma.meetingSeries.findFirst({ where: { id: src.seriesId, userId, deletedAt: null }, select: { cadence: true } });
    if (series) {
      cadence = series.cadence as Cadence;
      const live = await prisma.plannedMeeting.findMany({
        where: { userId, seriesId: src.seriesId, deletedAt: null },
        orderBy: { startAt: "desc" },
        take: 400,
        select: { startAt: true, status: true },
      });
      if (live[0]) latestStartMs = Math.max(latestStartMs, live[0].startAt.getTime());
      plannedStartsMs = live.filter((p) => p.status === "PLANNED").map((p) => p.startAt.getTime());
    }
  }
  const seriesId = cadence ? src.seriesId : null;
  const choice = chooseNextStart({ sourceStartMs: src.startAt.getTime(), latestStartMs, cadence, timeZone: src.timeZone, nowMs, plannedStartsMs });
  if (!choice) return { ok: false, status: 503, error: "Couldn't work out the next date. Plan it by hand." };
  const startAt = new Date(choice.startMs);

  const items = await openTasks(userId, await sourceMeetingIds(userId, src));
  const heading = carriedHeading(src.title, dayInZone(src.startAt, src.timeZone));

  let id: string;
  let existing = true;
  const found = await prisma.plannedMeeting.findFirst({
    where: { userId, seriesId, startAt, deletedAt: null, status: { not: "CANCELLED" }, ...(seriesId ? {} : { title: src.title }) },
    select: { id: true, agenda: true },
  });
  let agendaNow: string | null = found?.agenda ?? null;
  if (found) {
    id = found.id;
  } else {
    try {
      const created = await prisma.plannedMeeting.create({
        data: {
          userId, seriesId, title: src.title, startAt, durationMin: src.durationMin, timeZone: src.timeZone, venue: src.venue, callUrl: src.callUrl,
        },
        select: { id: true },
      });
      id = created.id;
      existing = false;
      if (src.attendees.length) await prisma.plannedAttendee.createMany({ data: attendeeRows(id, src.attendees) });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, status: 409, error: "That date is already taken in this series (it may be a cancelled meeting). Pick the next date by hand." };
      }
      throw err;
    }
  }

  const merged = mergeCarryOver(agendaNow, carryPoints(items, opts.today), heading);
  if (merged.agenda !== (agendaNow ?? "").trim()) {
    await prisma.plannedMeeting.update({ where: { id }, data: { agenda: merged.agenda }, select: { id: true } });
    agendaNow = merged.agenda;
  }
  const row = await prisma.plannedMeeting.findFirst({ where: { id, userId }, select: PLAN_SELECT });
  if (!row) return { ok: false, status: 404, error: "Planned meeting not found" };
  return { ok: true, plan: toPlanDTO(row), existing, carried: carriedCount(row.agenda), added: merged.added };
}
