import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, badRequest, failed, isPlanningMissing, notFound, pausedResponse, planningMissing } from "@/lib/planningDb";
import { LinkBody } from "@/lib/planning";

export const dynamic = "force-dynamic";

/**
 * Ties a plan to the meeting recorded from it and marks the plan RECORDED. Idempotent. Meetings are created
 * on the device first and reach the server later, so a meeting id the server hasn't seen yet is accepted;
 * one that exists on the server must be the caller's own.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  const parsed = LinkBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid meeting id");
  const { meetingId } = parsed.data;
  try {
    const plan = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, meetingId: true } });
    if (!plan) return notFound();
    if (plan.meetingId === meetingId) return Response.json({ ok: true, status: "RECORDED" }, { headers: NO_STORE });
    if (plan.meetingId) {
      return Response.json({ error: "This meeting was already recorded." }, { status: 409, headers: NO_STORE });
    }
    const existing = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { userId: true } });
    if (existing && existing.userId !== userId) return notFound("Meeting");
    const taken = await prisma.plannedMeeting.findUnique({ where: { meetingId }, select: { id: true } });
    if (taken) return Response.json({ error: "That recording is already linked to a planned meeting." }, { status: 409, headers: NO_STORE });
    await prisma.plannedMeeting.update({ where: { id }, data: { meetingId, status: "RECORDED" }, select: { id: true } });
    return Response.json({ ok: true, status: "RECORDED" }, { headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ error: "That recording is already linked to a planned meeting." }, { status: 409, headers: NO_STORE });
    }
    console.error("Plan link error:", err);
    return failed("Couldn't link the recording. Try again.");
  }
}
