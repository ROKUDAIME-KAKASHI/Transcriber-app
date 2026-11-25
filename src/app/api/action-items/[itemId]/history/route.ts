import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { listEvents, withLive } from "@/lib/actionItemHistory";
import { HISTORY_MAX } from "@/lib/taskHistory";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Change history of one task, newest first. `events: null` means history isn't available yet (migration not applied). */
export async function GET(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { itemId } = await params;
  try {
    const owned = await withLive((live) =>
      prisma.actionItem.findFirst({ where: { id: itemId, userId, ...live }, select: { id: true } })
    );
    if (!owned) return Response.json({ error: "Task not found" }, { status: 404, headers: NO_STORE });
    return Response.json({ events: await listEvents(userId, itemId, HISTORY_MAX) }, { headers: NO_STORE });
  } catch (err) {
    console.error("Action item history error:", err instanceof Error ? err.message : "unknown");
    return Response.json({ events: null }, { headers: NO_STORE });
  }
}
