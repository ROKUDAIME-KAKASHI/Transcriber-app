"use client";

import { useEffect, useState } from "react";
import { MeetingRecorder, isNativeApp } from "@/lib/nativeRecorder";

export interface BackgroundRecording {
  active: boolean;
  paused: boolean;
  seconds: number;
  level: number;
}

/**
 * Read-only poll of the native recorder, for pages other than Record.
 * Only the native service can keep recording off the Record route (web recordings stop on leave).
 * Never starts, stops or pauses anything.
 */
export function useBackgroundRecording(enabled: boolean): BackgroundRecording | null {
  const [state, setState] = useState<BackgroundRecording | null>(null);

  useEffect(() => {
    if (!enabled || !isNativeApp()) {
      setState(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          // from beyond parts.size copies zero parts, same cheap probe as recordingFlag.ts
          const s = await MeetingRecorder.getState({ from: 1_000_000_000 });
          if (!cancelled) {
            const next: BackgroundRecording = {
              active: !!s.active,
              paused: !!s.paused,
              seconds: Math.floor(s.seconds ?? 0),
              level: s.level ?? 0,
            };
            setState((prev) => {
              if (!next.active) return prev === null ? prev : null;
              if (
                prev &&
                prev.active === next.active &&
                prev.paused === next.paused &&
                prev.seconds === next.seconds &&
                Math.abs(prev.level - next.level) <= 0.05
              )
                return prev;
              return next;
            });
          }
        } catch {
          /* bridge busy: try again next tick */
        }
      }
      if (!cancelled) timer = setTimeout(tick, 1000);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return enabled ? state : null;
}
