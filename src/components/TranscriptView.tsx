import type { TranscriptPart } from "@/lib/transcript";

export function TranscriptView({ parts, interimText }: { parts: TranscriptPart[]; interimText?: string }) {
  return (
    <div className="space-y-5">
      {parts.map((part, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Speaker {part.speaker}
          </span>
          <p className="text-base sm:text-lg leading-relaxed">{part.text}</p>
        </div>
      ))}
      {interimText && (
        <div className="flex flex-col gap-1 animate-pulse">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Listening…</span>
          <p className="text-base sm:text-lg leading-relaxed italic text-foreground/70">{interimText}</p>
        </div>
      )}
    </div>
  );
}
