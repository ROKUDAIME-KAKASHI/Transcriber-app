import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isFlagOn } from "./flags";

/**
 * Server helpers for the tracker upgrades (Phase 16). Everything here degrades to "exactly as before":
 * flag off, 7_tracker not applied, People/planning tables missing -> the extra data is simply left out.
 */

/** True for a missing table (P2021) or column (P2022). */
export function isMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export async function trackerPlusOn(): Promise<boolean> {
  return isFlagOn("trackerPlus");
}

export const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Run a query that may use ActionItem.ownerStakeholderId. With the flag off, or when the column does not exist yet
 * (7_tracker not applied), it runs again without it. `link` tells the callback which variant it is in.
 */
export async function withOwnerLink<T>(run: (link: boolean) => Promise<T>): Promise<T> {
  if (!(await trackerPlusOn())) return run(false);
  try {
    return await run(true);
  } catch (err) {
    if (!isMissing(err)) throw err;
    return run(false);
  }
}

export interface OwnerLinked {
  owner: string | null;
  ownerStakeholderId?: string | null;
}

/**
 * Swap the stored owner text for the person's current name (so a rename in People shows up) and add their designation.
 * A person who was deleted, or an unreadable directory, leaves the stored text and clears the link.
 */
export async function resolveOwners<T extends OwnerLinked>(
  userId: string,
  rows: T[]
): Promise<(Omit<T, "ownerStakeholderId"> & { ownerStakeholderId: string | null; ownerDesignation: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.ownerStakeholderId).filter((x): x is string => !!x))];
  const people = new Map<string, { name: string; designation: string | null }>();
  if (ids.length) {
    try {
      const found = await prisma.stakeholder.findMany({
        where: { userId, deletedAt: null, id: { in: ids } },
        select: { id: true, name: true, designation: true },
      });
      for (const p of found) people.set(p.id, { name: p.name, designation: p.designation });
    } catch (err) {
      if (!isMissing(err)) console.error("Owner resolve error:", err instanceof Error ? err.message : "unknown");
    }
  }
  return rows.map((r) => {
    const p = r.ownerStakeholderId ? people.get(r.ownerStakeholderId) : undefined;
    return { ...r, owner: p ? p.name : r.owner, ownerStakeholderId: p ? (r.ownerStakeholderId ?? null) : null, ownerDesignation: p?.designation ?? null };
  });
}

/** meetingId -> the (live) series of the planned meeting it was recorded from. Empty when planning is off or not migrated. */
export async function seriesByMeeting(userId: string, meetingIds: string[]): Promise<Map<string, { id: string; title: string }>> {
  const out = new Map<string, { id: string; title: string }>();
  if (!meetingIds.length || !(await isFlagOn("plannedMeetings"))) return out;
  try {
    const rows = await prisma.plannedMeeting.findMany({
      where: { userId, deletedAt: null, seriesId: { not: null }, meetingId: { in: meetingIds } },
      select: { meetingId: true, series: { select: { id: true, title: true, deletedAt: true } } },
    });
    for (const r of rows) if (r.meetingId && r.series && !r.series.deletedAt) out.set(r.meetingId, { id: r.series.id, title: r.series.title });
  } catch (err) {
    if (!isMissing(err)) console.error("Series lookup error:", err instanceof Error ? err.message : "unknown");
  }
  return out;
}

/** A live person of this user, or null (also null when the directory is unavailable). */
export async function livePerson(userId: string, id: string): Promise<{ id: string; name: string } | null> {
  try {
    return await prisma.stakeholder.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, name: true } });
  } catch (err) {
    if (!isMissing(err)) console.error("Person lookup error:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}
