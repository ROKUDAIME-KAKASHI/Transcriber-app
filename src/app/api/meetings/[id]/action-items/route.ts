import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { SaveBody } from "@/lib/actionItems";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";

const SELECT = {
  id: true, task: true, owner: true, deadlineText: true, sourceQuote: true, status: true, createdAt: true,
} as const;

async function ownsMeeting(id: string, userId: string) {
  return !!(await prisma.meeting.findFirst({ where: { id, userId }, select: { id: true } }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await ownsMeeting(id, userId))) return Response.json({ error: "Meeting not found" }, { status: 404 });
    const items = await prisma.actionItem.findMany({
      where: { meetingId: id, userId },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
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
    await prisma.actionItem.createMany({
      data: parsed.data.items.map((i) => ({ ...i, meetingId: id, userId })),
    });
    const items = await prisma.actionItem.findMany({
      where: { meetingId: id, userId },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    return Response.json({ items, saved: parsed.data.items.length });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action items save error:", err);
    return Response.json({ error: "Couldn't save the tasks. Try again." }, { status: 503 });
  }
}
