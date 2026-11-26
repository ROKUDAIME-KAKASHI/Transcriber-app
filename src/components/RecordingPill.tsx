"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LiveDot } from "./ui";
import { Waveform } from "./Waveform";
import { RecordingControls, useFloatingBarFlag } from "./RecordingControls";
import { useMotionPref } from "@/lib/motionPref";
import { formatDuration } from "@/lib/transcript";
import { MeetingRecorder } from "@/lib/nativeRecorder";
import * as haptics from "@/lib/haptics";
import { useBackgroundRecording, type BackgroundRecording } from "@/hooks/useBackgroundRecording";
import { useRecorderActions, useRecorderStateOptional } from "./RecorderProvider";

/**
 * Floating glass pill on every page except Record while a recording is running or paused.
 * Two sources: the app-level recorder (RecorderProvider: laptops, phones in the browser, and on-device
 * capture in the app) and, in the Android app, the native cloud service (polled, see useBackgroundRecording).
 * Tap the body to return to Record. This is the only place besides Record that subscribes to the
 * fast-changing recorder state, so other pages never re-render on a transcript tick.
 */
export function RecordingPill() {
  const pathname = usePathname();
  const away = pathname !== "/";
  const web = useRecorderStateOptional();
  const actions = useRecorderActions();
  const bg = useBackgroundRecording(away);
  if (!away) return null;
  if (web?.isRecording && actions) {
    return (
      <Pill
        paused={web.isPaused}
        seconds={web.recordingSeconds}
        level={web.micLevel}
        onPause={actions.pause}
        onResume={actions.resume}
        onStop={() => actions.stop()}
        goToRecord
      />
    );
  }
  if (!bg?.active) return null;
  return <NativePill state={bg} />;
}

function NativePill({ state }: { state: BackgroundRecording }) {
  const router = useRouter();
  // Optimistic pause flag until the 1 s poll catches up (avoids a double-tap flip-flop).
  const [pendingPaused, setPendingPaused] = useState<boolean | null>(null);
  useEffect(() => setPendingPaused(null), [state.paused]);
  const paused = pendingPaused ?? state.paused;
  return (
    <Pill
      paused={paused}
      seconds={state.seconds}
      level={state.level}
      onPause={() => {
        setPendingPaused(true);
        MeetingRecorder.pause().catch(() => setPendingPaused(null));
      }}
      onResume={() => {
        setPendingPaused(false);
        MeetingRecorder.resume().catch(() => setPendingPaused(null));
      }}
      // An offline (on-device) capture is finished by the Record screen, which turns the audio into text:
      // go there once the service has been told to stop.
      onStop={() =>
        MeetingRecorder.stop({ force: false }).then(() => {
          if (state.mode === "local") router.push("/");
        })
      }
    />
  );
}

function Pill({
  paused,
  seconds,
  level,
  onPause,
  onResume,
  onStop,
  goToRecord = false,
}: {
  paused: boolean;
  seconds: number;
  level: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<unknown> | void;
  /** After Stop, open Record so it shows the finished meeting (and queues its minutes). */
  goToRecord?: boolean;
}) {
  const { reduced } = useMotionPref();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  useFloatingBarFlag(true);

  const stop = () => {
    if (stopping) return;
    setStopping(true);
    haptics.stop();
    Promise.resolve(onStop())
      .then(() => {
        if (goToRecord) router.push("/");
      })
      .catch(() => setStopping(false));
  };

  return (
    <div className="pop-in glass fixed inset-x-4 bottom-[calc(76px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-30 mx-auto flex h-12 max-w-sm items-center gap-2 rounded-full pl-4 pr-1 shadow-float lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0">
      <Link
        href="/"
        aria-label="Back to recording"
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-full transition-transform duration-[var(--dur-1)] active:scale-[0.96]"
      >
        <LiveDot paused={paused} />
        <span className="num text-ui font-semibold">{formatDuration(seconds)}</span>
        {paused && <span className="text-meta font-semibold text-warning-text">Paused</span>}
        <Waveform level={paused ? 0 : level} bars={10} height={20} reduced={reduced} className="ml-auto" />
      </Link>
      <RecordingControls paused={paused} onPause={onPause} onResume={onResume} onStop={stop} disabled={stopping} />
    </div>
  );
}
