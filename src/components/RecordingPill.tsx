"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveDot } from "./ui";
import { Waveform } from "./Waveform";
import { RecordingControls, useFloatingBarFlag } from "./RecordingControls";
import { useMotionPref } from "@/lib/motionPref";
import { formatDuration } from "@/lib/transcript";
import { MeetingRecorder } from "@/lib/nativeRecorder";
import * as haptics from "@/lib/haptics";
import type { BackgroundRecording } from "@/hooks/useBackgroundRecording";

/**
 * Floating glass pill on non-Record pages while the native service records.
 * Tap the body to return to Record; the buttons pause/resume and stop the service directly.
 * Only the native service can keep recording off the Record route (web recordings stop on leave),
 * so there is no in-page recorder to drive from here. Stop is the same call useNativeRecorder uses;
 * the service finalizes the meeting itself and the Record screen mirrors the final copy on next open.
 */
export function RecordingPill({ state }: { state: BackgroundRecording | null }) {
  if (!state?.active) return null;
  return <Pill state={state} />;
}

function Pill({ state }: { state: BackgroundRecording }) {
  const { reduced } = useMotionPref();
  const [stopping, setStopping] = useState(false);
  // Optimistic pause flag until the 1 s poll catches up (avoids a double-tap flip-flop).
  const [pendingPaused, setPendingPaused] = useState<boolean | null>(null);
  useEffect(() => setPendingPaused(null), [state.paused]);
  useFloatingBarFlag(true);
  const paused = pendingPaused ?? state.paused;

  const pause = () => {
    setPendingPaused(true);
    MeetingRecorder.pause().catch(() => setPendingPaused(null));
  };
  const resume = () => {
    setPendingPaused(false);
    MeetingRecorder.resume().catch(() => setPendingPaused(null));
  };
  const stop = () => {
    if (stopping) return;
    setStopping(true);
    haptics.stop();
    MeetingRecorder.stop({ force: false }).catch(() => setStopping(false));
  };

  return (
    <div className="pop-in glass fixed inset-x-4 bottom-[calc(88px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-30 mx-auto flex h-12 max-w-sm items-center gap-2 rounded-full pl-4 pr-1 shadow-float lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0">
      <Link
        href="/"
        aria-label="Back to recording"
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-full transition-transform duration-[var(--dur-1)] active:scale-[0.96]"
      >
        <LiveDot paused={paused} />
        <span className="font-mono text-ui font-semibold tabular-nums">{formatDuration(state.seconds)}</span>
        {paused && <span className="text-meta font-semibold text-warning">Paused</span>}
        <Waveform level={paused ? 0 : state.level} bars={10} height={20} reduced={reduced} className="ml-auto" />
      </Link>
      <RecordingControls paused={paused} onPause={pause} onResume={resume} onStop={stop} disabled={stopping} />
    </div>
  );
}
