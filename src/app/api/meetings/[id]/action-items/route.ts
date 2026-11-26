import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { SaveBody } from "@/lib/actionItems";
import { lenientServerNow, validateDeadline } from "@/lib/deadline";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { recordEvents, withLive } from "@/lib/actionItemHistory";
import { skipExactDuplicates } from "@/lib/dedupe";
import { resolveOwners, withOwnerLink } from "@/lib/trackerPlusDb";

const SELECT = {
  id: true, task: true, owner: true, deadlineText: true, dueDate: true, note: true, sourceQuote: true, status: true, createdAt: true,
} as const;

async function ownsMeeting(id: string, userId: string) {
  return !!(await prisma.meeting.findFirst({ where: { id, userId }, select: { id: true } }));
}

async function listItems(meetingId: string, userId: string) {
  const { rows, linked } = await withOwnerLink(async (link) => ({
    linked: link,
    rows: await withLive((live) =>
      prisma.actionItem.findMany({
        where: { meetingId, userId, ...live },
        orderBy: { createdAt: "asc" },
        select: link ? { ...SELECT, ownerStakeholderId: true } : SELECT,
      })
    ),
  }));
  // A renamed person shows their current name; a deleted one keeps the stored text.
  return linked ? resolveOwners(userId, rows as (typeof rows[number] & { ownerStakeholderId?: string | null })[]) : rows;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await ownsMeeting(id, userId))) return Response.json({ error: "Meeting not found" }, { status: 404 });
    const items = await listItems(id, userId);
    return Response.json({ items });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action items list error:", err);
    return Response.json({ error: "Couldn't load the tasks. Try again." }, { status: 503 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const parsed = SaveBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid tasks" }, { status: 400 });
  // New tasks: a due date can't be in the past or more than 5 years out.
  for (const it of parsed.data.items) {
    const bad = validateDeadline(it.dueDate, { now: lenientServerNow() });
    if (bad) return Response.json({ error: bad }, { status: 400 });
  }
  try {
    if (!(await ownsMeeting(id, userId))) return Response.json({ error: "Meeting not found" }, { status: 404 });
    // Skip tasks already saved for this meeting, and repeats inside this request. Nothing is ever deleted here.
    const existing = await withLive((live) =>
      prisma.actionItem.findMany({ where: { meetingId: id, userId, ...live }, select: { task: true } })
    );
    const { fresh, skipped } = skipExactDuplicates(parsed.data.items, existing.map((e) => e.task));
    if (fresh.length) {
      // Picked People entries must be this user's live people; anything else is saved as plain text.
      const wanted = [...new Set(fresh.map((i) => i.ownerStakeholderId).filter((x): x is string => !!x))];
      const valid = new Set<string>();
      if (wanted.length) {
        try {
          const found = await prisma.stakeholder.findMany({ where: { userId, deletedAt: null, id: { in: wanted } }, select: { id: true } });
          for (const f of found) valid.add(f.id);
        } catch {
          /* directory unavailable: owners stay plain text */
        }
      }
      const created = await withOwnerLink((link) =>
        prisma.actionItem.createManyAndReturn({
          data: fresh.map(({ ownerStakeholderId, dueDate, ...i }) => ({
            ...i,
            ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00.000Z`) } : {}),
            meetingId: id,
            userId,
            ...(link && ownerStakeholderId && valid.has(ownerStakeholderId) ? { ownerStakeholderId } : {}),
          })),
          select: { id: true },
        })
      );
      await recordEvents(
        userId,
        created.map((c) => ({ actionItemId: c.id, draft: { action: "created", field: null, oldValue: null, newValue: null } }))
      );
    }
    const items = await listItems(id, userId);
    return Response.json({ items, saved: fresh.length, skipped });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action items save error:", err);
    return Response.json({ error: "Couldn't save the tasks. Try again." }, { status: 503 });
  }
}
