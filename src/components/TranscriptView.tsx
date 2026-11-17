import type { TranscriptPart } from "@/lib/transcript";

/**
 * Transcript as a chat: one bubble per phrase.
 * With several speakers (older meetings recorded with speaker labels), even-numbered speakers
 * sit on the left and odd ones on the right, each with its own colour. With a single speaker
 * all bubbles sit on the left without names.
 */
const SPEAKER_COLORS = 6;

function speakerVars(speaker: number): React.CSSProperties {
  const c = `var(--speaker-${speaker % SPEAKER_COLORS})`;
  return {
    "--bubble-color": c,
    backgroundColor: `color-mix(in srgb, ${c} 13%, var(--card))`,
  } as React.CSSProperties;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-bounce"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

export function TranscriptView({
  parts,
  interimText,
  liveStatus,
  backlog = 0,
}: {
  parts: TranscriptPart[];
  interimText?: string;
  liveStatus?: "listening" | "transcribing" | null;
  backlog?: number;
}) {
  const multiSpeaker = new Set(parts.map((p) => p.speaker)).size > 1;
  const showLive = !!interimText || !!liveStatus;

  return (
    <div className="flex flex-col gap-1.5" role="log" aria-live="polite">
      {parts.map((part, i) => {
        const right = multiSpeaker && part.speaker % 2 === 1;
        const firstOfRun = i === 0 || parts[i - 1].speaker !== part.speaker;
        return (
          <div key={i} className={`flex flex-col ${right ? "items-end" : "items-start"} ${firstOfRun && i > 0 ? "mt-2" : ""}`}>
            {multiSpeaker && firstOfRun && (
              <span
                className="text-[11px] font-bold uppercase tracking-wider mb-0.5 px-1"
                style={{ color: `var(--speaker-${part.speaker % SPEAKER_COLORS})` }}
              >
                Speaker {part.speaker + 1}
              </span>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] sm:text-base leading-relaxed ${
                right ? "rounded-br-md" : "rounded-bl-md"
              }`}
              style={speakerVars(part.speaker)}
            >
              {part.text}
            </div>
          </div>
        );
      })}

      {showLive && (
        <div className={`flex flex-col items-start ${parts.length ? "mt-1" : ""}`}>
          <div
            className="max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2 text-[15px] sm:text-base leading-relaxed bg-muted text-foreground/60 italic"
            aria-label={interimText ? "Live transcription" : liveStatus === "listening" ? "Listening" : "Transcribing"}
          >
            {interimText ? (
              <>
                {interimText.replace(/\s*…$/, "")} <TypingDots />
              </>
            ) : (
              <TypingDots />
            )}
          </div>
          {backlog > 1 && (
            <span className="text-[11px] text-muted-foreground mt-1 px-1">
              Catching up · {backlog} phrases waiting
            </span>
          )}
        </div>
      )}
    </div>
  );
}
