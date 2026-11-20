"use client";

import { memo, useMemo, useState } from "react";
import { formatDuration, type TranscriptPart } from "@/lib/transcript";

/**
 * The transcript as a readable document: paragraphs with a time (and, for multi-speaker
 * recordings, the speaker) in a left column.
 *
 * Long meetings: a 10-hour meeting has thousands of phrases. Rendering all of them on every
 * live update froze phones after a few hours, so only a window is drawn (`window`: the latest
 * paragraphs while recording, the first ones on a saved meeting) with a button for the rest.
 * The component is memoised so mic-level updates (~12/s) don't re-render it.
 */
const SPEAKER_COLORS = 6;
/** A paragraph closes after this long or this much text, even if the same person keeps talking. */
const PARAGRAPH_MAX_SECONDS = 60;
const PARAGRAPH_MAX_CHARS = 700;

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

const speakerColor = (s: number) => `var(--speaker-${s % SPEAKER_COLORS})`;

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function TranscriptViewImpl({
  parts,
  interimText,
  liveStatus,
  backlog = 0,
  window: windowMode = "head",
  pageSize = 200,
}: {
  parts: TranscriptPart[];
  interimText?: string;
  liveStatus?: "listening" | "transcribing" | null;
  backlog?: number;
  /** "tail": newest paragraphs (live recording). "head": from the start (reading a saved meeting). */
  window?: "head" | "tail";
  pageSize?: number;
}) {
  const paragraphs = useMemo(() => toParagraphs(parts), [parts]);
  const multiSpeaker = useMemo(() => new Set(parts.map((p) => p.speaker)).size > 1, [parts]);
  const [shown, setShown] = useState(pageSize);
  const hidden = Math.max(0, paragraphs.length - shown);
  const visible = windowMode === "tail" ? paragraphs.slice(hidden) : paragraphs.slice(0, shown);
  const showLive = !!interimText || !!liveStatus;
  const more = (
    <button
      type="button"
      onClick={() => setShown((n) => n + pageSize * 2)}
      className="mx-auto my-2 block min-h-10 rounded-lg px-4 text-meta font-medium text-accent hover:bg-accent/10"
    >
      Show {Math.min(hidden, pageSize * 2).toLocaleString("en-IN")} {windowMode === "tail" ? "earlier" : "more"} paragraphs
      {hidden > pageSize * 2 ? ` of ${hidden.toLocaleString("en-IN")}` : ""}
    </button>
  );

  return (
    <div role="log" aria-live="polite" aria-relevant="additions">
      {windowMode === "tail" && hidden > 0 && more}
      <div className="space-y-5">
        {visible.map((p, i) => {
          const prev = i > 0 ? visible[i - 1] : windowMode === "tail" && hidden > 0 ? paragraphs[hidden - 1] : undefined;
          const showSpeaker = multiSpeaker && (!prev || prev.speaker !== p.speaker);
          return (
            <div key={i} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-x-4">
              <span className="pt-[3px] text-meta tabular-nums text-muted-foreground">
                {typeof p.t === "number" ? formatDuration(Math.floor(p.t)) : ""}
              </span>
              <div className="min-w-0">
                {showSpeaker && (
                  <span className="mb-1 flex items-center gap-2 text-meta font-semibold" style={{ color: speakerColor(p.speaker) }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: speakerColor(p.speaker) }} aria-hidden />
                    Speaker {p.speaker + 1}
                  </span>
                )}
                <p className="max-w-[68ch] text-base leading-7 text-foreground">{p.text}</p>
              </div>
            </div>
          );
        })}

        {showLive && (
          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-x-4">
            <span className="pt-[3px] text-meta text-muted-foreground">Now</span>
            <div className="min-w-0">
              <p className="max-w-[68ch] text-base leading-7 text-muted-foreground" aria-label={interimText ? "Live transcription" : "Listening"}>
                {interimText ? (
                  <>
                    {interimText.replace(/\s*…$/, "")}{" "}
                    <span className="inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-accent" aria-hidden />
                  </>
                ) : (
                  <TypingDots />
                )}
              </p>
              {backlog > 1 && <p className="mt-1 text-meta text-muted-foreground">Catching up · {backlog} phrases waiting</p>}
            </div>
          </div>
        )}
      </div>
      {windowMode === "head" && hidden > 0 && <div className="mt-6">{more}</div>}
    </div>
  );
}

export const TranscriptView = memo(TranscriptViewImpl);
