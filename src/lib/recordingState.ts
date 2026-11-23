// Pure rules for stuck recordings. No imports, so Node's type stripping can run this in tests.

/** A RECORDING meeting with no update for this long is labelled "Not responding" (autosave is every ~5 s). */
export const STALE_RECORDING_MS = 120_000;

export type MeetingOrigin = "local" | "server" | "native";

function ms(v: string | null | undefined): number {
  if (!v) return 0;
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Last sign of life: the newest of the device's own write and the server's updatedAt. */
export function lastActivityMs(row: { lastWriteAt?: number; serverUpdatedAt?: string | null }): number {
  return Math.max(row.lastWriteAt ?? 0, ms(row.serverUpdatedAt));
}

export function isStaleRecording(
  row: { status: string; lastWriteAt?: number; serverUpdatedAt?: string | null; createdAt?: string },
  now: number,
  staleMs: number = STALE_RECORDING_MS,
): boolean {
  if (row.status !== "RECORDING") return false;
  const last = Math.max(lastActivityMs(row), 0) || ms(row.createdAt);
  if (!last) return false;
  return now - last > staleMs;
}

/**
 * Whether the Meetings list offers "Stop recording" for a row.
 * - Recorded on another device (origin "server"): always; we cannot see whether it is alive.
 * - Web recorder on this device: only when it is not the live session (a leftover).
 * - Native service on this device: only when stale (the service may well be running).
 */
export function canStopFromList(a: {
  status: string;
  origin: MeetingOrigin;
  activeHere: boolean;
  stale: boolean;
}): boolean {
  if (a.status !== "RECORDING") return false;
  if (a.origin === "server") return true;
  if (a.activeHere) return false;
  if (a.origin === "native") return a.stale;
  return true;
}

/** Server reply to an autosave PATCH: was the meeting stopped from somewhere else? */
export function isStoppedReply(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as { stopped?: unknown; status?: unknown };
  return d.stopped === true || d.status === "DONE";
}

export function stopConfirmText(deviceName: string | null | undefined): string {
  const where = deviceName?.trim() ? deviceName.trim() : "the other device";
  return `Stop the recording on ${where}? What's been saved so far is kept.`;
}
