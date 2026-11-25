import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** True when the ClientError table (or a column) isn't in the database yet: migrations haven't run. */
export function isErrorLogMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export type ErrorRow = {
  id: string;
  kind: string;
  message: string;
  count: number;
  lastSeenAt: Date;
  appVersion: string | null;
  url: string | null;
};

/** Latest 50 fingerprints by last seen. `available` is false when the table doesn't exist yet. */
export async function loadErrorRows(): Promise<{ available: boolean; rows: ErrorRow[] }> {
  try {
    const rows = await prisma.clientError.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: { id: true, kind: true, message: true, count: true, lastSeenAt: true, appVersion: true, url: true },
    });
    return { available: true, rows };
  } catch {
    return { available: false, rows: [] };
  }
}
