"use client";

import type { Ref } from "react";
import { Pencil } from "lucide-react";

const SPEAKER_COLORS = 6;
const speakerColor = (s: number) => `var(--speaker-${s % SPEAKER_COLORS})`;

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
  if (!onClick) {
    return (
      <span className="mb-1 flex items-center gap-2 text-meta font-semibold" style={{ color }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
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
        className="group inline-flex h-7 items-center gap-2 rounded-full px-2 text-meta font-semibold transition-colors hover:bg-muted active:bg-muted"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
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
