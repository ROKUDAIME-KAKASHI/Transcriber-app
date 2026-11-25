import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { emailConfigured } from "@/lib/bookingEmail";
import { calendarMissing, calendarPaused, isCalendarMissing } from "@/lib/calendarDb";
import { NO_STORE, failed, notFound, pausedResponse } from "@/lib/planningDb";

export const dynamic = "force-dynamic";

/**
 * Calendar details of one plan, kept apart from the plan itself so the plan routes work before 6_calendar is
 * applied: who was emailed an invite (attendee id -> time) and whether the server can send email at all.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = (await calendarPaused()) ?? (await pausedResponse());
  if (paused) return paused;
  const { id } = await params;
  try {
    const row = await prisma.plannedMeeting.findFirst({
      where: { id, userId, deletedAt: null },
      select: { icsSequence: true, attendees: { select: { id: true, invitedAt: true } } },
    });
    if (!row) return notFound();
    const invited: Record<string, string> = {};
    for (const a of row.attendees) if (a.invitedAt) invited[a.id] = a.invitedAt.toISOString();
    return Response.json({ icsSequence: row.icsSequence, invited, emailConfigured: emailConfigured() }, { headers: NO_STORE });
  } catch (err) {
    if (isCalendarMissing(err)) return calendarMissing();
    console.error("Plan calendar read error:", err);
    return failed("Couldn't load the invite details. Try again.");
  }
}
