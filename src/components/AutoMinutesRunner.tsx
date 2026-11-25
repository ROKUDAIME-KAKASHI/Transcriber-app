"use client";

import { useEffect, useRef } from "react";
import { useConnectivity } from "@/lib/connectivity";
import { useFlag } from "@/lib/flagsClient";
import { isRecordingActive } from "@/lib/recordingFlag";
import { shouldRunNow } from "@/lib/autoMinutesCore";
import { pendingAutoIds, runAuto } from "@/lib/minutesJob";
import { sweepLocalMeetingData } from "@/lib/meetingExtras";
import { useLocalUser } from "./SyncProvider";

const TICK_MS = 30_000;

/**
 * Writes the minutes for meetings that were just recorded (queued by the Recorder on Stop). Waits while
 * offline, signed out or recording, then runs each queued meeting once.
 */
export function AutoMinutesRunner(): null {
  const { userId } = useLocalUser();
  const conn = useConnectivity();
  const on = useFlag("autoMinutes");
  const busy = useRef(false);

  // Once per sign-in: drop unscoped or month-old leftovers (summary, pending items, chat) from this device.
  useEffect(() => {
    if (userId) sweepLocalMeetingData();
  }, [userId]);

  useEffect(() => {
    if (!on || !userId) return;
    const pass = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const ids = pendingAutoIds(userId);
        if (!ids.length) return;
        const recording = await isRecordingActive();
        if (!shouldRunNow({ flagOn: on, online: conn !== "offline", signedIn: !!userId, recording })) return;
        for (const id of ids) await runAuto(userId, id);
      } catch (e) {
        console.warn("auto minutes pass failed", e);
      } finally {
        busy.current = false;
      }
    };
    void pass();
    const t = setInterval(() => void pass(), TICK_MS);
    const kick = () => void pass();
    window.addEventListener("minutely:autominutes", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      clearInterval(t);
      window.removeEventListener("minutely:autominutes", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [on, userId, conn]);

  return null;
}
