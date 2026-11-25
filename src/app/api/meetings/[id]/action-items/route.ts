import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { SaveBody } from "@/lib/actionItems";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { recordEvents, withLive } from "@/lib/actionItemHistory";
import { skipExactDuplicates } from "@/lib/dedupe";

const SELECT = {
  id: true, task: true, owner: true, deadlineText: true, dueDate: true, note: true, sourceQuote: true, status: true, createdAt: true,
} as const;

async function ownsMeeting(id: string, userId: string) {
  return !!(await prisma.meeting.findFirst({ where: { id, userId }, select: { id: true } }));
}

function listItems(meetingId: string, userId: string) {
  return withLive((live) =>
    prisma.actionItem.findMany({
      where: { meetingId, userId, ...live },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    })
  );
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
  try {
    if (!(await ownsMeeting(id, userId))) return Response.json({ error: "Meeting not found" }, { status: 404 });
    // Skip tasks already saved for this meeting, and repeats inside this request. Nothing is ever deleted here.
    const existing = await withLive((live) =>
      prisma.actionItem.findMany({ where: { meetingId: id, userId, ...live }, select: { task: true } })
    );
    const { fresh, skipped } = skipExactDuplicates(parsed.data.items, existing.map((e) => e.task));
    if (fresh.length) {
      const created = await prisma.actionItem.createManyAndReturn({
        data: fresh.map((i) => ({ ...i, meetingId: id, userId })),
        select: { id: true },
      });
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
