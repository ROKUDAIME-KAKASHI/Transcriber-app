"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, X } from "lucide-react";
import { formatDuration, speakerLabel, type SpeakerNames, type TranscriptPart } from "@/lib/transcript";
import type { SpeakerStatus } from "@/lib/speech/diarize";
import { SpeakerChip, speakerColor } from "./SpeakerChip";
import { RenameSpeakerSheet } from "./RenameSpeakerSheet";

/**
 * The transcript as a readable document: paragraphs with a time (and, for multi-speaker
 * recordings, the speaker) in a left column.
 *
 * Long meetings: a 10-hour meeting has thousands of phrases. Rendering all of them on every
 * live update froze phones after a few hours, so only a window is drawn (`window`: the latest
 * paragraphs while recording, the first ones on a saved meeting) with a button for the rest.
 * The component is memoised so mic-level updates (~12/s) don't re-render it.
 */
/** A paragraph closes after this long or this much text, even if the same person keeps talking. */
const PARAGRAPH_MAX_SECONDS = 60;
const PARAGRAPH_MAX_CHARS = 700;
const HINT_KEY = "speakerRenameHintSeen";
const IDENTIFYING_MIN_MS = 1000;
const REFINING_DELAY_MS = 300;

type Paragraph = { speaker: number; t?: number; text: string };

function toParagraphs(parts: TranscriptPart[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    const sameSpeaker = last && last.speaker === p.speaker;
    const tooLong =
      !last ||
      last.text.length > PARAGRAPH_MAX_CHARS ||
      (typeof last.t === "number" && typeof p.t === "number" && p.t - last.t > PARAGRAPH_MAX_SECONDS);
    if (sameSpeaker && !tooLong) last.text = `${last.text} ${p.text}`;
    else out.push({ speaker: p.speaker, t: p.t, text: p.text });
  }
  return out;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

/** Status shown to the user: "identifying" is held >= 1 s, "refining" appears after 300 ms. */
function useShownStatus(status: SpeakerStatus | undefined): SpeakerStatus {
  const [shown, setShown] = useState<SpeakerStatus>(null);
  const since = useRef(0);
  const want = status ?? null;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (want === shown) return;
    if (want === "refining") {
      t = setTimeout(() => setShown("refining"), REFINING_DELAY_MS);
    } else if (want === null && shown === "identifying") {
      const left = IDENTIFYING_MIN_MS - (Date.now() - since.current);
      t = setTimeout(() => setShown(null), Math.max(0, left));
    } else {
      if (want === "identifying") since.current = Date.now();
      t = setTimeout(() => setShown(want), 0);
    }
    return () => clearTimeout(t);
  }, [want, shown]);
  return shown;
}

function TranscriptViewImpl({
  parts,
  interimText,
  liveStatus,
  backlog = 0,
  window: windowMode = "head",
  pageSize = 200,
  speakerNames,
  onRenameSpeaker,
  speakerStatus,
  renameHint = false,
}: {
  parts: TranscriptPart[];
  interimText?: string;
  liveStatus?: "listening" | "transcribing" | null;
  backlog?: number;
  /** "tail": newest paragraphs (live recording). "head": from the start (reading a saved meeting). */
  window?: "head" | "tail";
  pageSize?: number;
  speakerNames?: SpeakerNames;
  /** Absent: chips are plain labels. Resolves false when the name couldn't be saved. */
  onRenameSpeaker?: (speaker: number, name: string) => Promise<boolean>;
  speakerStatus?: SpeakerStatus;
  /** Show the one-time "tap a name to rename" hint (meeting page only). */
  renameHint?: boolean;
}) {
  const paragraphs = useMemo(() => toParagraphs(parts), [parts]);
  const multiSpeaker = useMemo(() => new Set(parts.map((p) => p.speaker)).size > 1, [parts]);
  const [shown, setShown] = useState(pageSize);
  const hidden = Math.max(0, paragraphs.length - shown);
  const visible = windowMode === "tail" ? paragraphs.slice(hidden) : paragraphs.slice(0, shown);
  const showLive = !!interimText || !!liveStatus;

  // Keyed by speaker id, not by paragraph index: indexes shift while recording (tail window, merged paragraphs).
  const [renaming, setRenaming] = useState<{ speaker: number } | null>(null);
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  const [hintSeen, setHintSeen] = useState(true);
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {}
    const t = setTimeout(() => setHintSeen(seen), 0);
    return () => clearTimeout(t);
  }, []);
  const markHintSeen = () => {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {}
    setHintSeen(true);
  };
  const chipShownAt = (i: number) => {
    const p = visible[i];
    const prev = i > 0 ? visible[i - 1] : windowMode === "tail" && hidden > 0 ? paragraphs[hidden - 1] : undefined;
    return multiSpeaker && !!p && (!prev || prev.speaker !== p.speaker);
  };
  // The sheet opens at the first visible chip of the speaker being renamed.
  const renameHost = renaming ? visible.findIndex((p, i) => p.speaker === renaming.speaker && chipShownAt(i)) : -1;
  const closeRename = () => {
    const idx = renameHost;
    setRenaming(null);
    if (idx >= 0) requestAnimationFrame(() => chipRefs.current.get(idx)?.focus());
  };

  const shownStatus = useShownStatus(speakerStatus);
  const backlogShown = backlog > 1;
  const statusLine =
    backlogShown || !shownStatus ? null : (
      <p className="flex min-h-5 items-center gap-2 text-meta text-muted-foreground" aria-live="off">
        {shownStatus === "identifying" && (
          <>
            <TypingDots />
            Identifying speakers
          </>
        )}
        {shownStatus === "catching-up" && "Catching up on transcription first, speakers will follow"}
        {shownStatus === "refining" && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Refining speakers
          </>
        )}
      </p>
    );
  const wasRefining = useRef(false);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (shownStatus === "refining") {
      wasRefining.current = true;
      const t = setTimeout(() => setAnnounce("Refining speakers"), 0);
      return () => clearTimeout(t);
    }
    if (wasRefining.current) {
      wasRefining.current = false;
      const t = setTimeout(() => setAnnounce("Speakers updated"), 0);
      return () => clearTimeout(t);
    }
  }, [shownStatus]);

  const more = (
    <button
      type="button"
      onClick={() => setShown((n) => n + pageSize * 2)}
      className="mx-auto my-2 block min-h-10 rounded-chip px-4 text-meta font-medium text-accent hover:bg-accent/10"
    >
      Show {Math.min(hidden, pageSize * 2).toLocaleString("en-IN")} {windowMode === "tail" ? "earlier" : "more"} paragraphs
      {hidden > pageSize * 2 ? ` of ${hidden.toLocaleString("en-IN")}` : ""}
    </button>
  );

  return (
    <div role="log" aria-live="polite" aria-relevant="additions">
      <span className="sr-only" role="status">
        {announce}
      </span>
      {renameHint && multiSpeaker && onRenameSpeaker && !hintSeen && (
        <div className="mb-4 flex items-center gap-2 text-meta text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Tap a speaker&apos;s name to rename it.</span>
          <button
            type="button"
            aria-label="Dismiss hint"
            onClick={markHintSeen}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-chip hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {windowMode === "tail" && hidden > 0 && more}
      <div className="space-y-4">
        {visible.map((p, i) => {
          const showSpeaker = chipShownAt(i);
          return (
            <div
              key={i}
              className={`min-w-0 border-l-[3px] pl-3${windowMode === "tail" ? " text-in" : ""}`}
              style={{ borderColor: speakerColor(p.speaker) }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {showSpeaker && (
                  <div className="relative">
                    <SpeakerChip
                      speaker={p.speaker}
                      label={speakerLabel(p.speaker, speakerNames)}
                      expanded={renameHost === i}
                      buttonRef={(el) => {
                        if (el) chipRefs.current.set(i, el);
                        else chipRefs.current.delete(i);
                      }}
                      onClick={
                        onRenameSpeaker
                          ? () => (renameHost === i ? closeRename() : setRenaming({ speaker: p.speaker }))
                          : undefined
                      }
                    />
                    {onRenameSpeaker && renameHost === i && (
                      <RenameSpeakerSheet
                        speaker={p.speaker}
                        currentName={speakerNames?.[String(p.speaker)]}
                        onClose={closeRename}
                        onSave={async (name) => {
                          const ok = await onRenameSpeaker(p.speaker, name);
                          if (ok) {
                            markHintSeen();
                            closeRename();
                          }
                          return ok;
                        }}
                      />
                    )}
                  </div>
                )}
                {typeof p.t === "number" && (
                  <span className="font-mono text-meta tabular-nums text-muted-foreground">{formatDuration(Math.floor(p.t))}</span>
                )}
              </div>
              <p className="mt-1 max-w-[68ch] break-words text-reading leading-[1.6] text-foreground sm:text-base">{p.text}</p>
            </div>
          );
        })}

        {showLive && (
          <div className="min-w-0 border-l-[3px] border-border pl-3">
            <span className="font-mono text-meta text-muted-foreground">Now</span>
            <div className="min-w-0">
              <p className="mt-1 max-w-[68ch] break-words text-reading leading-[1.6] text-muted-foreground sm:text-base" aria-label={interimText ? "Live transcription" : "Listening"}>
                {interimText ? (
                  <>
                    {interimText.replace(/\s*…$/, "")}{" "}
                    <span className="inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-accent" aria-hidden />
                  </>
                ) : (
                  <TypingDots />
                )}
              </p>
              {backlogShown && <p className="mt-1 text-meta text-muted-foreground">Catching up · {backlog} phrases waiting</p>}
              {shownStatus !== "refining" && statusLine && <div className="mt-1">{statusLine}</div>}
            </div>
          </div>
        )}
        {!showLive && shownStatus !== "refining" && statusLine && <div>{statusLine}</div>}
        {shownStatus === "refining" && <div className="min-h-5">{statusLine}</div>}
      </div>
      {windowMode === "head" && hidden > 0 && <div className="mt-6">{more}</div>}
    </div>
  );
}

export const TranscriptView = memo(TranscriptViewImpl);
