import { MeetingRecorder, isNativeApp } from "@/lib/nativeRecorder";
import { clearNativeCapture, getMeta, markStoppedRemotely } from "./repo";

/** "finish-here": the audio is still on this phone, so the transcript has to be finished here (Record screen), not marked DONE. */
export type StopResult = "ok" | "auth" | "error" | "finish-here";

/**
 * Ends a recording that is stuck or running on another device: the server marks it DONE (what was
 * saved is kept), then the device copy follows so sync doesn't fight it. The recording device
 * notices on its next autosave (see `stopped` in PATCH /api/meetings/:id).
 */
export async function stopRecordingRemotely(userId: string | null, id: string): Promise<StopResult> {
  try {
    // A recording made offline on this phone: ending it on the server would drop the audio that has not
    // been transcribed yet (and needs no internet). Stop the capture and let the Record screen finish it.
    const row = userId ? await getMeta(userId, id) : null;
    if (row?.nativeCapture === 1 && userId && isNativeApp()) {
      const list = await MeetingRecorder.listCaptures().catch(() => null);
      if (list?.captures.some((c) => c.meetingId === id)) {
        // Only stop the service when it is recording THIS meeting (it may be recording another one).
        const st = await MeetingRecorder.getState({ from: 1_000_000_000 }).catch(() => null);
        if (st?.active && st.mode === "local" && st.meetingId === id) await MeetingRecorder.stop({ force: false }).catch(() => {});
        return "finish-here";
      }
      // The audio is gone from this phone (the start never got far): nothing to finish, end it normally.
      if (list) await clearNativeCapture(userId, id);
    }
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
