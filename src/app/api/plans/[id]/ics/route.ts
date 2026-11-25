import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { buildIcs } from "@/lib/scheduling";
import { NO_STORE, PLAN_SELECT, failed, isPlanningMissing, notFound, pausedResponse, planningMissing, toPlanDTO } from "@/lib/planningDb";
import { attendeeLine, endOf } from "@/lib/planning";

export const dynamic = "force-dynamic";

/** .ics for one plan. Owner only (the invite is built from the owner's private plan). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const [row, me] = await Promise.all([
      prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: PLAN_SELECT }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!row || !me) return notFound();
    const p = toPlanDTO(row);
    const description = [
      p.callUrl ? `Join: ${p.callUrl}` : "",
      p.attendees.length ? `With: ${p.attendees.map(attendeeLine).join(", ")}` : "",
      p.agenda?.trim() ? `Agenda\n${p.agenda.trim()}` : "",
    ].filter(Boolean).join("\n\n");
    const ics = buildIcs({
      uid: `plan-${p.id}@transcriber`,
      start: new Date(p.startAt),
      end: endOf(p),
      title: p.title,
      description: description || null,
      location: p.venue ?? p.callUrl,
      organizerName: me.email.split("@")[0] || "Organizer",
      organizerEmail: me.email,
      attendees: p.attendees.filter((a) => a.email).map((a) => ({ name: a.name, email: a.email as string })),
      cancelled: p.status === "CANCELLED",
    });
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="meeting.ics"',
        ...NO_STORE,
      },
    });
  } catch (err) {
    if (isPlanningMissing(err)) return planningMissing();
    console.error("Plan ICS error:", err);
    return failed("Couldn't create the calendar file.");
  }
}
