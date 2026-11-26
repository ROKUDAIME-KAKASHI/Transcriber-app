"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import type { NamerState } from "@/lib/naming/screenNamer";
import type { SpeakerNames } from "@/lib/transcript";
import { RenameSpeakerSheet } from "./RenameSpeakerSheet";
import { SpeakerChip } from "./SpeakerChip";

/**
 * While a call is recorded with screen naming on: a small "Reading names on this device" line, and a chip for each
 * name that was read from the screen. "probably X" until three reads agree. Tap a chip to fix it (it opens the usual
 * rename sheet, and a name you type is never changed again).
 */
export function NamingStrip({
  state,
  names,
  onRename,
}: {
  state: NamerState | null | undefined;
  names: SpeakerNames;
  onRename: (speaker: number, name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!state || state.status === "unavailable") {
    return state ? (
      <p className="px-1 text-meta text-muted-foreground">Names can't be read from the call screen on this browser. Voices stay Speaker 1, 2…</p>
    ) : null;
  }
  const entries = Object.entries(state.auto).filter(([k, v]) => v.source === "screen" && names?.[k] === v.name);
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="flex items-center gap-1.5 px-1 text-meta text-muted-foreground">
        <Eye className={`h-3.5 w-3.5 ${state.reading ? "animate-pulse text-accent-text" : ""}`} aria-hidden />
        {state.status === "loading" ? "Getting ready to read names on this device…" : "Reading names on this device"}
      </p>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entries.map(([k, v]) => {
            const n = Number(k);
            return (
              <div key={k} className="relative inline-flex items-center gap-1.5">
                {v.level === "probable" && <span className="text-meta text-muted-foreground">probably</span>}
                <SpeakerChip speaker={n} label={v.name} onClick={() => setOpen(open === n ? null : n)} expanded={open === n} />
                {open === n && (
                  <RenameSpeakerSheet
                    speaker={n}
                    currentName={v.name}
                    onSave={async (name) => {
                      const ok = await onRename(n, name);
                      if (ok) setOpen(null);
                      return ok;
                    }}
                    onClose={() => setOpen(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {entries.length > 0 && <p className="px-1 text-meta text-muted-foreground">Wrong name? Tap it to fix.</p>}
    </div>
  );
}
