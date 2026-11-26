import { formatDuration, speakerLabel, type SpeakerNames } from "@/lib/transcript";
import { talkTime, type TalkPart } from "@/lib/talkTime";
import { speakerColor } from "./SpeakerChip";

/** One thin bar showing who spoke how much, with a legend. Needs two or more speakers. Computed from the transcript on the page. */
export function TalkTimeStrip({ parts, names }: { parts: readonly TalkPart[]; names?: SpeakerNames }) {
  const shares = talkTime(parts);
  if (shares.length < 2) return null;
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  return (
    <div className="mb-5" role="group" aria-label="Talk time per speaker">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {shares.map((s) => (
          <span key={s.speaker} className="h-full min-w-1" style={{ flexGrow: s.share, flexBasis: 0, background: speakerColor(s.speaker) }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {shares.map((s) => (
          <li key={s.speaker} className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: speakerColor(s.speaker) }} />
            <span className="truncate font-semibold text-foreground">{speakerLabel(s.speaker, names)}</span>
            <span className="tabular-nums">
              {pct(s.share)} · {formatDuration(Math.round(s.seconds))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
