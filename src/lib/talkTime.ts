/** Talk time per speaker, from the transcript phrases already on the page. No imports, so node:test can load it. */

export interface TalkPart {
  speaker: number;
  text: string;
  t?: number;
}

export interface TalkShare {
  speaker: number;
  seconds: number;
  /** 0..1 share of everyone's talk time. */
  share: number;
}

const WORDS_PER_SECOND = 2.5;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Seconds each person spoke. A phrase lasts until the next one starts, but never longer than its words need
 * (plus 2 s), so silence and pauses don't count. Without times, it is estimated from the word count.
 * Biggest talker first; ties keep speaker order.
 */
export function talkTime(parts: readonly TalkPart[]): TalkShare[] {
  const secs = new Map<number, number>();
  parts.forEach((p, i) => {
    const est = wordCount(p.text) / WORDS_PER_SECOND;
    const next = parts[i + 1];
    const gap = typeof p.t === "number" && next && typeof next.t === "number" ? next.t - p.t : null;
    const d = gap !== null && gap >= 0 ? Math.min(gap, est + 2) : est;
    secs.set(p.speaker, (secs.get(p.speaker) ?? 0) + d);
  });
  const total = Array.from(secs.values()).reduce((a, b) => a + b, 0);
  return Array.from(secs, ([speaker, seconds]) => ({ speaker, seconds, share: total > 0 ? seconds / total : 0 })).sort(
    (a, b) => b.seconds - a.seconds || a.speaker - b.speaker
  );
}
