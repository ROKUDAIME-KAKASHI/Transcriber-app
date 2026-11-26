import { prisma } from "@/lib/prisma";
import type { MeetingSummary } from "./combined";
import { isMissingDbError, nameOrDefault, parseStoredSummary } from "./polishCore";

/**
 * Reads and writes of the 8_polish columns. Until the owner runs the migration the columns do not exist, so every
 * helper catches P2021/P2022 and falls back (summary: null so the device copy is used; name: "You", not saved).
 */

/** The saved summary, or null (none yet, or the column is missing). */
export async function readSummary(id: string, userId: string): Promise<MeetingSummary | null> {
  try {
    const m = await prisma.meeting.findFirst({ where: { id, userId }, select: { summary: true } });
    return parseStoredSummary(m?.summary);
  } catch (err) {
    if (isMissingDbError(err)) return null;
    throw err;
  }
}

/** Saves the summary. Returns false when the column is missing (the device copy still works). */
export async function saveSummary(id: string, userId: string, summary: MeetingSummary): Promise<boolean> {
  try {
    const { count } = await prisma.meeting.updateMany({ where: { id, userId }, data: { summary: JSON.stringify(summary) } });
    return count > 0;
  } catch (err) {
    if (isMissingDbError(err)) return false;
    throw err;
  }
}

/** The name used for "You". "You" when unset or when the column is missing. */
export async function readDisplayName(userId: string): Promise<{ name: string; custom: boolean }> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return { name: nameOrDefault(u?.displayName), custom: !!u?.displayName?.trim() };
  } catch (err) {
    if (isMissingDbError(err)) return { name: nameOrDefault(null), custom: false };
    throw err;
  }
}

/** Returns false when the column is missing (the app needs the database update). */
export async function saveDisplayName(userId: string, name: string | null): Promise<boolean> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { displayName: name }, select: { id: true } });
    return true;
  } catch (err) {
    if (isMissingDbError(err)) return false;
    throw err;
  }
}
