import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  NO_STORE, PLAN_SELECT, attendeeRows, badRequest, failed, isPlanningMissing, notFound, ownsSeries, pausedResponse, planningMissing, toPlanDTO,
} from "@/lib/planningDb";
import { PlanPatch } from "@/lib/planning";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const row = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: PLAN_SELECT });
    if (!row) return notFound();
    return Response.json({ plan: toPlanDTO(row) }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan read error:", err);
    return failed("Couldn't load this meeting. Try again.");
  }
}

/** Partial update. `attendees`, when sent, replaces the whole list. */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  const parsed = PlanPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid details");
  const { attendees, startAt, seriesId, title, durationMin, timeZone, venue, callUrl, agenda, status } = parsed.data;
  try {
    const current = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, status: true } });
    if (!current) return notFound();
    if (seriesId && !(await ownsSeries(userId, seriesId))) return badRequest("That series doesn't exist");
    // A recorded meeting stays recorded; only a plan that hasn't happened can be cancelled or re-opened.
    if (status && current.status === "RECORDED") return badRequest("This meeting was already recorded.");
    await prisma.$transaction(async (tx) => {
      await tx.plannedMeeting.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(startAt !== undefined ? { startAt: new Date(startAt) } : {}),
          ...(durationMin !== undefined ? { durationMin } : {}),
          ...(timeZone !== undefined ? { timeZone } : {}),
          ...(venue !== undefined ? { venue } : {}),
          ...(callUrl !== undefined ? { callUrl } : {}),
          ...(agenda !== undefined ? { agenda } : {}),
          ...(seriesId !== undefined ? { seriesId: seriesId || null } : {}),
          ...(status !== undefined ? { status } : {}),
        },
        select: { id: true },
      });
      if (attendees) {
        await tx.plannedAttendee.deleteMany({ where: { plannedMeetingId: id } });
        if (attendees.length) await tx.plannedAttendee.createMany({ data: attendeeRows(id, attendees) });
      }
    });
    const row = await prisma.plannedMeeting.findFirst({ where: { id, userId }, select: PLAN_SELECT });
    return Response.json({ plan: row && toPlanDTO(row) }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan update error:", err);
    return failed("Couldn't save the changes. Try again.");
  }
}

/** Soft delete: the row stays, hidden everywhere. A linked recording is never touched. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const { count } = await prisma.plannedMeeting.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) return notFound();
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan delete error:", err);
    return failed("Couldn't delete this meeting. Try again.");
  }
}
