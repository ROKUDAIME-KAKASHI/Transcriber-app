import { Prisma } from "@prisma/client";
import { isFlagOn } from "./flags";
import { prisma } from "./prisma";
import { NO_STORE, isPlanningMissing } from "./planningDb";
import { parseStoredPoints, type RefPoint } from "./prework";

/** True when the PlanReference table isn't in the database yet: 5_prework hasn't been applied. */
export function isPreworkMissing(err: unknown): boolean {
  return isPlanningMissing(err) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021");
}

export const PREWORK_MISSING_MESSAGE = "Pre-work needs a database update";

export function preworkMissing(): Response {
  return Response.json({ error: PREWORK_MISSING_MESSAGE }, { status: 503, headers: NO_STORE });
}

/** Set when the owner has switched pre-work (or planning) off in Admin. */
export async function preworkPaused(): Promise<Response | null> {
  if ((await isFlagOn("prework")) && (await isFlagOn("plannedMeetings"))) return null;
  return Response.json({ error: "Pre-work is paused for now. Please check back later." }, { status: 503, headers: NO_STORE });
}

/** The plan, only when it belongs to the user. */
export async function ownedPlan(id: string, userId: string): Promise<boolean> {
  const p = await prisma.plannedMeeting.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  return !!p;
}

export const REFERENCE_SELECT = {
  id: true, fileName: true, mimeType: true, sizeBytes: true, truncated: true, points: true, summarizedAt: true, createdAt: true,
} as const;

export interface ReferenceDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  truncated: boolean;
  points: RefPoint[] | null;
  summarizedAt: string | null;
  createdAt: string;
}

export function toReferenceDTO(r: {
  id: string; fileName: string; mimeType: string; sizeBytes: number; truncated: boolean; points: unknown;
  summarizedAt: Date | null; createdAt: Date;
}): ReferenceDTO {
  return {
    id: r.id, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, truncated: r.truncated,
    points: parseStoredPoints(r.points), summarizedAt: r.summarizedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}
