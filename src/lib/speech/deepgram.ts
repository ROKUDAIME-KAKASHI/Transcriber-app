/**
 * Deepgram (cloud) live transcription: live words, speaker labels, better with accents and
 * Hindi. Paid per minute; audio is sent to Deepgram. The browser streams 16 kHz 16-bit PCM
 * (already filtered by the VoiceChunker's resampler) over a WebSocket authenticated with a
 * short-lived token from /api/deepgram/token, so the API key never reaches the browser.
 */
import type { Engine } from "./models";

/** Everything the Record screen can use: the two on-device models plus Deepgram. */
export type RecordEngine = Engine | "deepgram";

export const DEEPGRAM_SAMPLE_RATE = 16000;

/** "en" | "hi" | "auto" (the Record screen's language picker) → Deepgram language code. */
export function deepgramUrl(language: string): string {
  const params = new URLSearchParams({
    model: "nova-3",
    // "multi" is Nova-3's code-switching mode (handles English and Hindi mixed in one sentence).
    language: language === "auto" ? "multi" : language,
    encoding: "linear16",
    sample_rate: String(DEEPGRAM_SAMPLE_RATE),
    channels: "1",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    interim_results: "true",
    endpointing: "300",
    utterance_end_ms: "1000",
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

export async function fetchDeepgramToken(): Promise<string> {
  const res = await fetch("/api/deepgram/token", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not get a Deepgram token.");
  return data.token as string;
}

/** Float samples in −1…1 → little-endian 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

export type DeepgramWord = { word: string; punctuated_word?: string; speaker?: number; start: number; end: number };
export type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
};

/** Splits a final result into runs of consecutive words by the same speaker. */
export function speakerRuns(words: DeepgramWord[]): { speaker: number; text: string; start: number }[] {
  const runs: { speaker: number; words: string[]; start: number }[] = [];
  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const last = runs[runs.length - 1];
    const text = w.punctuated_word ?? w.word;
    if (last && last.speaker === speaker) last.words.push(text);
    else runs.push({ speaker, words: [text], start: w.start });
  }
  return runs.map((r) => ({ speaker: r.speaker, text: r.words.join(" "), start: r.start }));
}
