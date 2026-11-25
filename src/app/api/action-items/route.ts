import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { withLive } from "@/lib/actionItemHistory";
import { UNASSIGNED, isTaskStatus, sortTasks, type TaskStatus } from "@/lib/taskTracker";
import { resolveOwners, seriesByMeeting, withOwnerLink } from "@/lib/trackerPlusDb";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** All of the user's saved tasks across meetings, with the meeting they came from. */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const owner = q.get("owner")?.trim();
  const meetingId = q.get("meetingId")?.trim();

  const where: Record<string, unknown> = { userId };
  if (status === "open") where.status = { not: "DONE" };
  else if (isTaskStatus(status)) where.status = status as TaskStatus;
  if (meetingId) where.meetingId = meetingId;
  if (owner === UNASSIGNED) where.owner = null;
  else if (owner) where.owner = { equals: owner, mode: "insensitive" };

  try {
    const { rows, linked } = await withOwnerLink(async (link) => ({
      linked: link,
      rows: await withLive((live) => prisma.actionItem.findMany({
        where: { ...where, ...live },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          id: true, task: true, owner: true, deadlineText: true, dueDate: true, sourceQuote: true,
          status: true, note: true, createdAt: true,
          ...(link ? { ownerStakeholderId: true } : {}),
          meeting: { select: { id: true, title: true, createdAt: true } },
        },
      })),
    }));
    // Rename-proof owners and series chips only exist with the tracker upgrades switched on and migrated.
    const resolved = linked ? await resolveOwners(userId, rows as (typeof rows[number] & { ownerStakeholderId?: string | null })[]) : rows;
    const series = linked ? await seriesByMeeting(userId, [...new Set(rows.map((r) => r.meeting.id))]) : null;
    const items = sortTasks(
      resolved.map((r) => ({
        ...r,
        status: r.status as TaskStatus,
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        meeting: { ...r.meeting, createdAt: r.meeting.createdAt.toISOString() },
        ...(series ? { series: series.get(r.meeting.id) ?? null } : {}),
      }))
    );
    return Response.json({ items }, { headers: NO_STORE });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Tasks list error:", err);
    return Response.json({ error: "Couldn't load the tasks. Try again." }, { status: 503, headers: NO_STORE });
  }
}
