import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { PatchBody } from "@/lib/taskTracker";

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { itemId } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid update" }, { status: 400, headers: NO_STORE });
  try {
    // Scoped to the owner: updating someone else's (or a missing) id is a 404.
    const { count } = await prisma.actionItem.updateMany({ where: { id: itemId, userId }, data: parsed.data });
    if (!count) return Response.json({ error: "Task not found" }, { status: 404, headers: NO_STORE });
    const item = await prisma.actionItem.findFirst({
      where: { id: itemId, userId },
      select: { id: true, task: true, owner: true, deadlineText: true, dueDate: true, status: true, note: true, updatedAt: true },
    });
    return Response.json({ item }, { headers: NO_STORE });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action item update error:", err);
    return Response.json({ error: "Couldn't update the task. Try again." }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { itemId } = await params;
  try {
    // Scoped to the owner: deleting someone else's (or a missing) id is a 404.
    const { count } = await prisma.actionItem.deleteMany({ where: { id: itemId, userId } });
    if (!count) return Response.json({ error: "Task not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action item delete error:", err);
    return Response.json({ error: "Couldn't delete the task. Try again." }, { status: 503 });
  }
}
