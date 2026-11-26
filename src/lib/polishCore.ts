/** Pure helpers for the 8_polish columns (User.displayName, Meeting.summary). No database access here. */
import type { MeetingSummary } from "./combined.ts";

export const DEFAULT_NAME = "You";
export const NAME_MAX = 40;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

/** True when the database lacks the table or column the client expects (migration not applied yet). */
export function isMissingDbError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** Trim, collapse spaces, at most 40 characters, letters, spaces and . - ' only. Empty clears the name. */
export function cleanDisplayName(input: unknown): { ok: true; name: string | null } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "Enter a name." };
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, name: null };
  if (name.length > NAME_MAX) return { ok: false, error: `Use ${NAME_MAX} characters or fewer.` };
  if (!NAME_RE.test(name)) return { ok: false, error: "Use letters, spaces and . - ' only." };
  return { ok: true, name };
}

export function nameOrDefault(name: string | null | undefined): string {
  return name?.trim() || DEFAULT_NAME;
}

/** The summary is stored as JSON text. Anything unreadable counts as no summary. */
export function parseStoredSummary(raw: string | null | undefined): MeetingSummary | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MeetingSummary> | null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return {
      purpose: typeof v.purpose === "string" ? v.purpose : "",
      keyPoints: list(v.keyPoints),
      decisions: list(v.decisions),
      openQuestions: list(v.openQuestions),
      tone: typeof v.tone === "string" ? v.tone : "",
    };
  } catch {
    return null;
  }
}
