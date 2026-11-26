"use client";

import { Check, Loader2, Mic, Square } from "lucide-react";
import { RECORD_CONTROL_LABEL, type RecordControlState } from "@/lib/recordControl";
import { cx } from "./ui";

/**
 * The big record control. Each state has its own icon, colour and caption, so colour is never the only signal:
 * ready = accent outline, recording = record colour + pulse, paused = muted, saving = spinner, saved = tick.
 */
export function RecordButton({
  state,
  onClick,
  disabled = false,
  pulse = false,
  describedBy,
}: {
  state: RecordControlState;
  onClick?: () => void;
  disabled?: boolean;
  /** Pulse ring while recording (off under reduced motion and calm mode). */
  pulse?: boolean;
  describedBy?: string;
}) {
  const running = state === "recording" || state === "paused";
  const inert = state === "starting" || state === "saving";
  const off = disabled || inert;
  const aria =
    state === "recording" ? "Stop recording"
    : state === "paused" ? "Stop recording (paused)"
    : state === "starting" ? "Starting recording"
    : state === "saving" ? "Saving the recording"
    : "Start recording";
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={off ? undefined : onClick}
        disabled={off && !running}
        aria-disabled={off}
        aria-describedby={describedBy}
        aria-label={aria}
        data-state={state}
        className={cx(
          "relative grid h-22 w-22 shrink-0 place-items-center rounded-full border-2 transition-colors duration-[var(--dur-2)]",
          state === "recording" && "border-record-fill bg-record-fill text-white",
          state === "paused" && "border-border bg-muted text-muted-foreground",
          !running && !inert && "border-accent bg-transparent text-accent-text hover:bg-accent-soft",
          inert && "border-border bg-muted text-muted-foreground",
          state === "error" && "border-danger bg-transparent text-danger-text",
          !running && "active:scale-95",
          off && !inert && "cursor-not-allowed opacity-40",
          inert && "cursor-wait"
        )}
      >
        {pulse && state === "recording" && (
          <span aria-hidden className="live-ring pointer-events-none absolute -inset-0.5 rounded-full bg-record-fill opacity-40" />
        )}
        {running ? (
          <Square className="relative h-6 w-6 fill-current" />
        ) : inert ? (
          <Loader2 className="relative h-7 w-7 animate-spin" />
        ) : state === "saved" ? (
          <Check className="relative h-8 w-8" />
        ) : (
          <Mic className="relative h-8 w-8" />
        )}
      </button>
      <span
        className={cx(
          "inline-flex min-h-5 items-center gap-1.5 text-meta font-semibold",
          state === "recording" && "text-record",
          state === "paused" && "text-warning-text",
          state === "saved" && "text-success-text",
          state === "error" && "text-danger-text",
          (state === "ready" || state === "starting" || state === "saving") && "text-muted-foreground"
        )}
        aria-live="polite"
      >
        {RECORD_CONTROL_LABEL[state]}
      </span>
    </div>
  );
}
