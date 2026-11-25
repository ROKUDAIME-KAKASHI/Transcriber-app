import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EventDraft, HistoryEvent } from "@/lib/taskHistory";

/** True when the 2_history migration hasn't been applied: a missing column (P2022) or table (P2021). */
export function isHistoryMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

/**
 * Run a query that must skip soft-deleted tasks. Before migration 2_history the deletedAt column does not exist,
 * so a missing-column error retries the same query without the filter.
 */
export async function withLive<T>(run: (live: { deletedAt: null } | Record<string, never>) => Promise<T>): Promise<T> {
  try {
    return await run({ deletedAt: null });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022") return run({});
    throw err;
  }
}

/** Record change events. Never throws: history must not fail the request that caused it. */
export async function recordEvents(userId: string, events: { actionItemId: string; draft: EventDraft }[]): Promise<void> {
  if (!events.length) return;
  try {
    await prisma.actionItemEvent.createMany({
      data: events.map(({ actionItemId, draft }) => ({
        actionItemId,
        userId,
        action: draft.action,
        field: draft.field,
        oldValue: draft.oldValue,
        newValue: draft.newValue,
      })),
    });
  } catch (err) {
    if (!isHistoryMissing(err)) console.error("Action item history write error:", err instanceof Error ? err.message : "unknown");
  }
}

/** The change history of one task, newest first. Returns null when history isn't available (migration not applied). */
export async function listEvents(userId: string, actionItemId: string, take: number): Promise<HistoryEvent[] | null> {
  try {
    const rows = await prisma.actionItemEvent.findMany({
      where: { actionItemId, userId },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, action: true, field: true, oldValue: true, newValue: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action as HistoryEvent["action"],
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    if (!isHistoryMissing(err)) console.error("Action item history read error:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}
