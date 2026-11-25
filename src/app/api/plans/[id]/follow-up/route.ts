import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PLAN_SELECT, badRequest, failed, isPlanningMissing, notFound, pausedResponse, planningMissing } from "@/lib/planningDb";
import { followUpPaused, planFollowUp, readBody } from "@/lib/followUpDb";

export const dynamic = "force-dynamic";

/**
 * Plan the next meeting after a recorded plan: next date in its series (or a week later), same details and attendees,
 * agenda with the unfinished tasks carried over. Asking twice returns the same meeting. Owner only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await pausedResponse()) ?? (await followUpPaused());
  if (paused) return paused;
  const { id } = await params;
  if (id.length > 40) return notFound();
  const body = readBody(await req.json().catch(() => null));
  try {
    const p = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: PLAN_SELECT });
    if (!p) return notFound();
    if (p.status !== "RECORDED" || !p.meetingId) return badRequest("Record this meeting first, then plan the next one.");
    const r = await planFollowUp(
      userId,
      {
        title: p.title, startAt: p.startAt, durationMin: p.durationMin, timeZone: p.timeZone, venue: p.venue, callUrl: p.callUrl,
        seriesId: p.seriesId, meetingId: p.meetingId,
        attendees: p.attendees.map((a) => ({ stakeholderId: a.stakeholderId, name: a.name, email: a.email, designation: a.designation, role: a.role })),
      },
      { today: body.today }
    );
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return Response.json({ plan: r.plan, existing: r.existing, carried: r.carried, added: r.added }, { status: r.existing ? 200 : 201, headers: NO_STORE });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan follow-up error:", err);
    return failed("Couldn't plan the next meeting. Try again.");
  }
}
