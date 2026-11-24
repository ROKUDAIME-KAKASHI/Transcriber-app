import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";

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
