"use client";

import Link from "next/link";
import { LiveDot } from "./ui";
import { Waveform } from "./Waveform";
import { useMotionPref } from "@/lib/motionPref";
import { formatDuration } from "@/lib/transcript";
import type { BackgroundRecording } from "@/hooks/useBackgroundRecording";

/** Floating glass pill on non-Record pages while the native service records. Tap returns to Record. */
export function RecordingPill({ state }: { state: BackgroundRecording | null }) {
  const { reduced } = useMotionPref();
  if (!state?.active) return null;
  return (
    <Link
      href="/"
      aria-label="Back to recording"
      className="pop-in glass fixed inset-x-4 bottom-[calc(88px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-30 mx-auto flex h-12 max-w-xs items-center gap-3 rounded-full px-4 shadow-float transition-transform duration-[var(--dur-1)] active:scale-[0.96] lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
    >
      <LiveDot paused={state.paused} />
      <span className="font-mono text-ui font-semibold tabular-nums">{formatDuration(state.seconds)}</span>
      {state.paused && <span className="text-meta font-semibold text-warning">Paused</span>}
      <Waveform level={state.paused ? 0 : state.level} bars={10} height={20} reduced={reduced} className="ml-auto" />
    </Link>
  );
}
