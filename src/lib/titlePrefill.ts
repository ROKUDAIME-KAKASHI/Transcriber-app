/**
 * A meeting title handed to Record by a link (/?title=...), used once for the next meeting.
 * Kept in sessionStorage so a reload before pressing Record doesn't lose it.
 */
const KEY = "transcriber.titlePrefill";
const MAX = 120;

let memory: string | null = null;

export function cleanTitle(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX);
  return t || null;
}

export function setTitlePrefill(raw: string | null | undefined): void {
  memory = cleanTitle(raw);
  try {
    if (memory) sessionStorage.setItem(KEY, memory);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the in-memory copy still works */
  }
}

export function peekTitlePrefill(): string | null {
  if (memory) return memory;
  try {
    return cleanTitle(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** The title for a meeting that is starting now, or the fallback. Clears the prefill. */
export function takeTitle(fallback: string): string {
  const t = peekTitlePrefill();
  if (t) setTitlePrefill(null);
  return t ?? fallback;
}
