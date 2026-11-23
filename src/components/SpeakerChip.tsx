"use client";

import type { Ref } from "react";
import { Pencil } from "lucide-react";

const SPEAKER_COLORS = 6;
export const speakerColor = (s: number) => `var(--speaker-${s % SPEAKER_COLORS})`;

/** A speaker's name in their colour. Tappable (opens rename) when `onClick` is given. */
export function SpeakerChip({
  speaker,
  label,
  onClick,
  expanded,
  buttonRef,
}: {
  speaker: number;
  label: string;
  onClick?: () => void;
  expanded?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const color = speakerColor(speaker);
  const avatar = (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-meta font-semibold"
      style={{ color, background: `color-mix(in oklab, ${color} 16%, var(--card))` }}
      aria-hidden
    >
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
  if (!onClick) {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-full bg-muted/60 pl-1 pr-3 text-meta font-semibold" style={{ color }}>
        {avatar}
        <span className="max-w-[12rem] truncate" title={label}>
          {label}
        </span>
      </span>
    );
  }
  return (
    <span className="-my-2 mb-0 inline-flex py-2">
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        aria-label={`Rename ${label}`}
        aria-haspopup="dialog"
        aria-expanded={!!expanded}
        className="group inline-flex h-8 items-center gap-2 rounded-full bg-muted/60 pl-1 pr-3 text-meta font-semibold transition-[transform,background-color] duration-[var(--dur-1)] hover:bg-muted active:scale-[0.96]"
      >
        {avatar}
        <span className="max-w-[12rem] truncate" style={{ color }} title={label}>
          {label}
        </span>
        <Pencil
          className="h-3 w-3 text-muted-foreground opacity-0 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100"
          aria-hidden
        />
      </button>
    </span>
  );
}
