export interface TranscriptPart {
  speaker: number;
  text: string;
  /** Seconds into the meeting (pauses excluded) when this phrase started. Missing on older meetings. */
  t?: number;
}

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "ta", label: "Tamil" },
  { value: "ml", label: "Malayalam" },
  { value: "kn", label: "Kannada" },
  { value: "auto", label: "Auto (mixed)" },
] as const;

export const TEMPLATES = [
  { value: "MOM", label: "Minutes of Meeting" },
  { value: "Report", label: "Report" },
] as const;

/** Custom speaker names keyed by 0-based speaker number as a string ("0", "1", ...). */
export type SpeakerNames = Record<string, string> | null | undefined;

/** The single producer of speaker labels: the trimmed custom name, else "Speaker N" (1-based). */
export function speakerLabel(n: number, names?: SpeakerNames): string {
  const custom = names?.[String(n)];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return `Speaker ${n + 1}`;
}

/**
 * Plain-text transcript for exports and the AI: one phrase per line, with a [mm:ss] time when
 * known. Speaker labels (a given name or "Speaker N", on-device or cloud) only appear when the
 * meeting has several speakers; pass `multiSpeaker` to force that decision for a chunk of a
 * longer meeting.
 */
export function transcriptToText(
  parts: TranscriptPart[],
  opts: { names?: SpeakerNames; multiSpeaker?: boolean } = {}
): string {
  const multiSpeaker = opts.multiSpeaker ?? new Set(parts.map((p) => p.speaker)).size > 1;
  return parts
    .map((p) => {
      const time = typeof p.t === "number" ? `[${formatDuration(Math.floor(p.t))}] ` : "";
      const who = multiSpeaker ? `${speakerLabel(p.speaker, opts.names)}: ` : "";
      return `${time}${who}${p.text}`;
    })
    .join(multiSpeaker ? "\n\n" : "\n");
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Best-effort label for the device a recording came from. */
export function detectDeviceName(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Browser";
}

export function parseTranscript(value: unknown): TranscriptPart[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is TranscriptPart =>
      !!p && typeof p === "object" && typeof p.speaker === "number" && typeof p.text === "string" &&
      (p.t === undefined || typeof p.t === "number")
  );
}
