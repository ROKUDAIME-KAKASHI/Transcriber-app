import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { PatchBody } from "@/lib/taskTracker";
import { recordEvents, withLive } from "@/lib/actionItemHistory";
import { diffTask, historyValue, type EventDraft } from "@/lib/taskHistory";
import { livePerson, trackerPlusOn, withOwnerLink } from "@/lib/trackerPlusDb";

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { itemId } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid update" }, { status: 400, headers: NO_STORE });
  try {
    // The values before the edit, for the change history. If this lookup fails the edit still goes ahead.
    const before = await withLive((live) =>
      prisma.actionItem.findFirst({ where: { id: itemId, userId, ...live }, select: { status: true, owner: true, dueDate: true, note: true, task: true } })
    ).catch(() => null);
    // Owner link (tracker upgrades): a picked person sets the id and the name; typing free text clears the id,
    // even from an older cached page that doesn't send it. Without the upgrades or the column, only the text is saved.
    const { ownerStakeholderId: requested, ...fields } = parsed.data;
    let linkValue: string | null | undefined;
    if (await trackerPlusOn()) {
      if (typeof requested === "string") {
        const person = await livePerson(userId, requested);
        if (person) {
          linkValue = person.id;
          fields.owner = person.name;
        } else if (fields.owner !== undefined) linkValue = null;
      } else if (requested === null || fields.owner !== undefined) linkValue = null;
    }
    // Scoped to the owner: updating someone else's (or a missing, or deleted) id is a 404.
    const { count } = await withOwnerLink((link) =>
      withLive((live) =>
        prisma.actionItem.updateMany({
          where: { id: itemId, userId, ...live },
          data: link && linkValue !== undefined ? { ...fields, ownerStakeholderId: linkValue } : fields,
        })
      )
    );
    if (!count) return Response.json({ error: "Task not found" }, { status: 404, headers: NO_STORE });
    if (before) await recordEvents(userId, diffTask(before, fields).map((draft) => ({ actionItemId: itemId, draft })));
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
    // Soft delete keeps the task's history. Before migration 2_history there is no deletedAt column: delete for real.
    const task = await withLive((live) =>
      prisma.actionItem.findFirst({ where: { id: itemId, userId, ...live }, select: { task: true } })
    ).catch(() => null);
    let count: number;
    try {
      ({ count } = await prisma.actionItem.updateMany({ where: { id: itemId, userId, deletedAt: null }, data: { deletedAt: new Date() } }));
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022")) throw err;
      ({ count } = await prisma.actionItem.deleteMany({ where: { id: itemId, userId } }));
      return count ? Response.json({ ok: true }) : Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (!count) return Response.json({ error: "Task not found" }, { status: 404 });
    const draft: EventDraft = { action: "deleted", field: null, oldValue: historyValue("task", task?.task ?? null)?.slice(0, 300) ?? null, newValue: null };
    await recordEvents(userId, [{ actionItemId: itemId, draft }]);
    return Response.json({ ok: true });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Action item delete error:", err);
    return Response.json({ error: "Couldn't delete the task. Try again." }, { status: 503 });
  }
}
