"use client";

import { useEffect } from "react";
import { Pause, Play, Square } from "lucide-react";

/**
 * Pause/resume + stop, shared by the Record screen's phone bar and the floating pill on other routes.
 * Two 40 px round icon buttons. Pass onPause = undefined to hide pause (mode can't pause).
 */
export function RecordingControls({
  paused,
  onPause,
  onResume,
  onStop,
  disabled = false,
}: {
  paused: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop: () => void;
  disabled?: boolean;
}) {
  const canPause = !!onPause && !!onResume;
  return (
    <>
      {canPause && (
        <button
          type="button"
          onClick={paused ? onResume : onPause}
          disabled={disabled}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card/70 transition-transform duration-[var(--dur-1)] active:scale-95 disabled:opacity-50"
          aria-label={paused ? "Resume recording" : "Pause recording"}
        >
          {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        disabled={disabled}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-record-fill text-white transition-transform duration-[var(--dur-1)] active:scale-95 disabled:opacity-50"
        aria-label="Stop recording"
      >
        <Square className="h-4 w-4 fill-current" />
      </button>
    </>
  );
}

/**
 * Marks that a floating recording bar/pill is on screen so the toast can stack above it
 * (html[data-float-bar], read by Toast.tsx).
 */
export function useFloatingBarFlag(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    const el = document.documentElement;
    el.dataset.floatBar = "1";
    return () => {
      delete el.dataset.floatBar;
    };
  }, [visible]);
}
