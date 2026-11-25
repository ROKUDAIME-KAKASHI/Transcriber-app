import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isFlagOn } from "./flags";
import type { AttendeeInput, Cadence, PlanDTO, SeriesDTO } from "./planning";

/** True when a planning table or column isn't in the database yet: 4_planned_meetings hasn't been applied. */
export function isPlanningMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export const PLANNING_MISSING_MESSAGE = "Planning needs a database update";

export const NO_STORE = { "Cache-Control": "no-store" };

export function planningMissing(): Response {
  return Response.json({ error: PLANNING_MISSING_MESSAGE }, { status: 503, headers: NO_STORE });
}

/** Set when the owner has switched planned meetings off in Admin. */
export async function pausedResponse(): Promise<Response | null> {
  if (await isFlagOn("plannedMeetings")) return null;
  return Response.json({ error: "Planning is paused for now. Please check back later." }, { status: 503, headers: NO_STORE });
}

export function notFound(what = "Planned meeting"): Response {
  return Response.json({ error: `${what} not found` }, { status: 404, headers: NO_STORE });
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: NO_STORE });
}

export function failed(message: string): Response {
  return Response.json({ error: message }, { status: 503, headers: NO_STORE });
}

export const ATTENDEE_SELECT = { id: true, stakeholderId: true, name: true, email: true, designation: true, role: true } as const;

export const PLAN_SELECT = {
  id: true, title: true, startAt: true, durationMin: true, timeZone: true, venue: true, callUrl: true, agenda: true,
  status: true, meetingId: true, bookingId: true, seriesId: true,
  series: { select: { id: true, title: true, cadence: true } },
  attendees: { select: ATTENDEE_SELECT, orderBy: { id: "asc" as const } },
} as const;

export const SERIES_SELECT = { id: true, title: true, cadence: true, defaultDurationMin: true, defaultVenue: true, defaultCallUrl: true } as const;

type PlanRow = Prisma.PlannedMeetingGetPayload<{ select: typeof PLAN_SELECT }>;

export function toPlanDTO(r: PlanRow): PlanDTO {
  return {
    id: r.id,
    title: r.title,
    startAt: r.startAt.toISOString(),
    durationMin: r.durationMin,
    timeZone: r.timeZone,
    venue: r.venue,
    callUrl: r.callUrl,
    agenda: r.agenda,
    status: (r.status === "RECORDED" || r.status === "CANCELLED" ? r.status : "PLANNED") as PlanDTO["status"],
    meetingId: r.meetingId,
    bookingId: r.bookingId,
    seriesId: r.seriesId,
    series: r.series ? { id: r.series.id, title: r.series.title, cadence: r.series.cadence as Cadence } : null,
    attendees: r.attendees.map((a) => ({
      id: a.id, stakeholderId: a.stakeholderId, name: a.name, email: a.email, designation: a.designation, role: a.role,
    })),
  };
}

export function toSeriesDTO(r: { id: string; title: string; cadence: string; defaultDurationMin: number; defaultVenue: string | null; defaultCallUrl: string | null }): SeriesDTO {
  return {
    id: r.id, title: r.title, cadence: r.cadence as Cadence, defaultDurationMin: r.defaultDurationMin,
    defaultVenue: r.defaultVenue, defaultCallUrl: r.defaultCallUrl,
  };
}

export function attendeeRows(plannedMeetingId: string, list: AttendeeInput[]) {
  return list.map((a) => ({
    plannedMeetingId,
    stakeholderId: a.stakeholderId ?? null,
    name: a.name,
    email: a.email ?? null,
    designation: a.designation ?? null,
    role: a.role ?? null,
  }));
}

/** A series id is only usable when it is the caller's own, live series. */
export async function ownsSeries(userId: string, seriesId: string): Promise<boolean> {
  const s = await prisma.meetingSeries.findFirst({ where: { id: seriesId, userId, deletedAt: null }, select: { id: true } });
  return !!s;
}

/**
 * A plan for a booking the host just received. Never throws: a missing table, a paused feature or any
 * error leaves the booking exactly as it was.
 */
export async function createPlanForBooking(b: {
  bookingId: string;
  hostUserId: string;
  eventTitle: string;
  guestName: string;
  guestEmail: string;
  agenda: string | null;
  startAt: Date;
  durationMin: number;
  hostTimeZone: string;
}): Promise<void> {
  try {
    if (!(await isFlagOn("plannedMeetings"))) return;
    const exists = await prisma.plannedMeeting.findUnique({ where: { bookingId: b.bookingId }, select: { id: true } });
    if (exists) return;
    await prisma.plannedMeeting.create({
      data: {
        userId: b.hostUserId,
        title: `${b.eventTitle} with ${b.guestName}`.slice(0, 200),
        startAt: b.startAt,
        durationMin: b.durationMin,
        timeZone: b.hostTimeZone,
        agenda: b.agenda ? b.agenda.slice(0, 8000) : null,
        bookingId: b.bookingId,
        attendees: { create: [{ name: b.guestName, email: b.guestEmail }] },
      },
      select: { id: true },
    });
  } catch (err) {
    if (!isPlanningMissing(err)) console.error("Plan for booking error:", err);
  }
}

/** A cancelled booking cancels its plan. Never throws. */
export async function cancelPlanForBooking(bookingId: string): Promise<void> {
  try {
    await prisma.plannedMeeting.updateMany({ where: { bookingId, status: "PLANNED" }, data: { status: "CANCELLED" } });
  } catch (err) {
    if (!isPlanningMissing(err)) console.error("Cancel plan for booking error:", err);
  }
}
