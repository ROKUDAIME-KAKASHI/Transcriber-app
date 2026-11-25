import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { withLive } from "@/lib/actionItemHistory";
import { matchOwnersToPeople } from "@/lib/trackerPlus";
import { NO_STORE, isMissing, trackerPlusOn } from "@/lib/trackerPlusDb";

export const dynamic = "force-dynamic";

const Body = z.object({ personIds: z.array(z.string().min(1).max(64)).max(1000).optional() }).strict();

/**
 * One-time helper: link tasks whose owner text equals a person's name (case-insensitive, exact) to that person.
 * The server recomputes the matches itself, scoped to the signed-in user, so the body can only narrow the people.
 * Owner text is never changed; the link just makes renames in People flow through.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!(await trackerPlusOn())) return Response.json({ error: "Task upgrades are paused" }, { status: 503, headers: NO_STORE });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const only = parsed.data.personIds ? new Set(parsed.data.personIds) : null;
  try {
    const [tasks, people] = await Promise.all([
      withLive((live) =>
        prisma.actionItem.findMany({
          where: { userId, ownerStakeholderId: null, owner: { not: null }, ...live },
          select: { id: true, owner: true },
          take: 5000,
        })
      ),
      prisma.stakeholder.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true }, take: 5000 }),
    ]);
    const plan = matchOwnersToPeople(tasks, people);
    let linked = 0;
    for (const m of plan.matches) {
      if (only && !only.has(m.personId)) continue;
      const { count } = await withLive((live) =>
        prisma.actionItem.updateMany({
          where: { userId, id: { in: m.taskIds }, ownerStakeholderId: null, ...live },
          data: { ownerStakeholderId: m.personId },
        })
      );
      linked += count;
    }
    return Response.json({ linked }, { headers: NO_STORE });
  } catch (err) {
    if (isMissing(err)) return Response.json({ error: "Tasks need a database update" }, { status: 503, headers: NO_STORE });
    console.error("Link owners error:", err instanceof Error ? err.message : "unknown");
    return Response.json({ error: "Couldn't link the owners. Try again." }, { status: 503, headers: NO_STORE });
  }
}
