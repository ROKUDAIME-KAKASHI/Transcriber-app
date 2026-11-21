import { Prisma } from "@prisma/client";

/** Client-generated meeting ids (existing cuids match too). */
export const MEETING_ID_RE = /^[a-z0-9_-]{16,40}$/;

export const MEETING_FULL_SELECT_LEGACY = {
  id: true, title: true, status: true, language: true, transcript: true, durationSec: true,
  deviceName: true, template: true, document: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.MeetingSelect;

export const MEETING_FULL_SELECT = {
  ...MEETING_FULL_SELECT_LEGACY,
  engine: true, speakerNames: true, titleUpdatedAt: true,
} as const satisfies Prisma.MeetingSelect;

export const MEETING_LIST_SELECT_LEGACY = {
  id: true, title: true, status: true, language: true, durationSec: true,
  deviceName: true, template: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.MeetingSelect;

export const MEETING_LIST_SELECT = {
  ...MEETING_LIST_SELECT_LEGACY,
  engine: true, titleUpdatedAt: true,
} as const satisfies Prisma.MeetingSelect;

/** True when the DB lacks a column the generated client expects (schema not pushed yet). */
export function isMissingColumn(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022";
}

/** Run with the new columns; if the schema isn't pushed yet, rerun against legacy columns only. */
export async function withLegacyFallback<T>(run: (legacy: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    console.warn("Schema not pushed yet; using legacy columns");
    return run(true);
  }
}

/** Accept a client clock only inside a sane window (2020 .. now + 5 min); else use server time. */
export function clampClientTime(value: string | undefined, now = new Date()): Date {
  if (!value) return now;
  const d = new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t) || t < Date.UTC(2020, 0, 1) || t > now.getTime() + 5 * 60_000) return now;
  return d;
}
