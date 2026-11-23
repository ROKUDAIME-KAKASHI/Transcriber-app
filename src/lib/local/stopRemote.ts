import { markStoppedRemotely } from "./repo";

export type StopResult = "ok" | "auth" | "error";

/**
 * Ends a recording that is stuck or running on another device: the server marks it DONE (what was
 * saved is kept), then the device copy follows so sync doesn't fight it. The recording device
 * notices on its next autosave (see `stopped` in PATCH /api/meetings/:id).
 */
export async function stopRecordingRemotely(userId: string | null, id: string): Promise<StopResult> {
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DONE" }),
    });
    if (res.status === 401 || res.status === 403) return "auth";
    // Gone on the server: nothing left to stop; the next pull removes the device copy.
    if (!res.ok && res.status !== 404) return "error";
    if (userId) await markStoppedRemotely(userId, id);
    return "ok";
  } catch {
    return "error";
  }
}
