"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import { useNameSuggestions } from "@/lib/nameSuggest";
import type { NameSuggestion } from "@/lib/nameDetect";
import { formatDuration, speakerLabel, type SpeakerNames, type TranscriptPart } from "@/lib/transcript";
import { useLocalUser } from "./SyncProvider";
import { useToast } from "./Toast";
import { RenameSpeakerSheet } from "./RenameSpeakerSheet";
import { speakerColor } from "./SpeakerChip";
import { Badge, Button, GateReason } from "./ui";

/**
 * Suggested speaker names as chips (Use / Edit / Dismiss). Nothing is renamed without a tap; accepting
 * goes through `onRename`, the same path as renaming by hand.
 */
export function NameSuggestions({
  meetingId,
  parts,
  names,
  enabled,
  onRename,
  onRenameMany,
}: {
  meetingId: string | null;
  parts: TranscriptPart[];
  names: SpeakerNames;
  /** Only true once speaker labels are final. */
  enabled: boolean;
  onRename: (speaker: number, name: string) => Promise<boolean>;
  /** Apply several names in one write, so quick accepts can't overwrite each other. */
  onRenameMany?: (updates: Record<number, string>) => Promise<boolean>;
}) {
  const { userId } = useLocalUser();
  const toast = useToast();
  const aiGate = useFeatureGate("ai");
  const { suggestions, askAi, dismiss, aiBusy, aiError, aiAsked, speakerCount, unnamed } = useNameSuggestions({
    meetingId,
    userId,
    parts,
    names,
    enabled,
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || speakerCount < 2 || unnamed === 0) return null;

  const use = async (s: NameSuggestion) => {
    setError(null);
    if (await onRename(s.speaker, s.name)) toast(`${speakerLabel(s.speaker)} is now ${s.name}`, "success");
    else setError("Couldn't save the name. Try again.");
  };
  const useAll = async () => {
    setError(null);
    let ok = true;
    if (onRenameMany) ok = await onRenameMany(Object.fromEntries(suggestions.map((s) => [s.speaker, s.name])));
    else for (const s of suggestions) ok = (await onRename(s.speaker, s.name)) && ok;
    if (ok) toast(`Named ${suggestions.length} speakers`, "success");
    else setError("Couldn't save the names. Try again.");
  };

  const aiHint = !aiGate.enabled ? aiGate.reason : null;

  return (
    <section aria-label="Name suggestions" className="mt-3 rounded-chip border border-border/70 bg-card p-3">
      {suggestions.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-meta font-semibold text-muted-foreground">Suggested names</h3>
            {suggestions.length > 1 && (
              <Button variant="ghost" className="!min-h-11 px-3 text-meta lg:!min-h-9" onClick={() => void useAll()}>
                Use all
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => {
              const color = speakerColor(s.speaker);
              return (
                <li key={`${s.speaker}|${s.name}`} className="relative flex flex-wrap items-center gap-2 rounded-chip bg-muted/50 p-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold"
                    style={{ color, background: `color-mix(in oklab, ${color} 16%, var(--card))` }}
                    aria-hidden
                  >
                    {s.speaker + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex flex-wrap items-center gap-2 text-ui font-semibold">
                      <span className="truncate">
                        {speakerLabel(s.speaker)} <span aria-hidden>→</span>
                        <span className="sr-only">is</span> {s.name}
                      </span>
                      {s.source === "ai" && <Badge tone="accent">AI</Badge>}
                    </p>
                    <p className="truncate text-meta text-muted-foreground" title={s.evidence}>
                      &ldquo;{s.evidence}&rdquo;
                      {typeof s.t === "number" ? ` · ${formatDuration(Math.floor(s.t))}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="primary"
                      className="!min-h-11 px-4 lg:!min-h-9"
                      onClick={() => void use(s)}
                      aria-label={`Use ${s.name} for ${speakerLabel(s.speaker)}`}
                    >
                      Use
                    </Button>
                    <Button
                      variant="ghost"
                      className="!min-h-11 px-3 lg:!min-h-9"
                      onClick={() => setEditing(s.speaker)}
                      aria-haspopup="dialog"
                      aria-label={`Edit name for ${speakerLabel(s.speaker)}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="!min-h-11 !min-w-11 px-0 lg:!min-h-9 lg:!min-w-9"
                      onClick={() => dismiss(s)}
                      aria-label={`Dismiss ${s.name} for ${speakerLabel(s.speaker)}`}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {editing === s.speaker && (
                    <RenameSpeakerSheet
                      speaker={s.speaker}
                      currentName={s.name}
                      onClose={() => setEditing(null)}
                      onSave={async (name) => {
                        const ok = await onRename(s.speaker, name);
                        if (ok) setEditing(null);
                        return ok;
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className={suggestions.length ? "mt-2" : ""}>
        <Button
          variant="secondary"
          className="!min-h-11 px-4 lg:!min-h-9"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          loading={aiBusy}
          disabled={!aiGate.enabled}
          aria-describedby={aiHint ? "name-ai-reason" : undefined}
          onClick={() => void askAi()}
        >
          Find names with AI
        </Button>
        <GateReason id="name-ai-reason" reason={aiHint} />
        {aiError && (
          <p className="mt-2 text-meta text-danger" role="alert">
            {aiError}
          </p>
        )}
        {aiAsked && !aiError && suggestions.length === 0 && (
          <p className="mt-2 text-meta text-muted-foreground">No names found in the conversation.</p>
        )}
      </div>
      {error && (
        <p className="mt-2 text-meta text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
