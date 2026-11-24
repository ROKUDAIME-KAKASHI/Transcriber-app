/**
 * Pure decisions for a native (locked-screen) on-device recording session. No imports, so node:test
 * can load it. The hook (useRecorder) does the I/O; these functions only decide.
 */
import { catchUpText, describeAudio } from "./nativeFeed.ts";

export const RECORDING_ON_PHONE_MSG = "Recording on this phone. Works offline and with the screen locked.";

/** The status line under the record button while a native session runs. */
export function nativeStatusLine(a: { paused: boolean; behindSamples: number; rate?: number | null }): string {
  if (a.paused) return "Paused. Nothing is being recorded.";
  const behind = catchUpText(a.behindSamples, a.rate);
  return behind || RECORDING_ON_PHONE_MSG;
}

/** The status line while Stop is draining what the phone recorded. */
export function finishingLine(behindSamples: number, rate?: number | null): string {
  if (behindSamples <= 0) return "Finishing transcription…";
  const eta = rate && isFinite(rate) && rate > 0 ? Math.round(behindSamples / 16000 / rate / 60) : null;
  const base = `Finishing transcription. ${describeAudio(behindSamples)} of audio left`;
  return eta !== null && eta >= 1 ? `${base} (about ${eta} min)` : `${base}.`;
}

/** What the page remembers about a device-store row. */
export interface NativeRowInfo {
  nativeCapture?: 0 | 1;
  nativeCursor?: number;
  status: string;
}

/** A capture folder as listed by the plugin. */
export interface CaptureInfoLite {
  meetingId: string;
  head: number;
  committed: number;
  state: "recording" | "stopped" | "interrupted";
  active: boolean;
  engine: string;
  language: string;
  startedAt: number;
  stoppedReason?: string | null;
}

/**
 * Which capture the Record screen should re-attach to: a service that is capturing right now wins,
 * otherwise a stopped/interrupted capture whose meeting is still flagged `nativeCapture` (those are
 * finished in 08-04). Folders with no device row are left alone: the row may belong to another
 * signed-in user's store.
 */
export function pickCapture(
  captures: readonly CaptureInfoLite[],
  rows: ReadonlyMap<string, NativeRowInfo>,
): { live: CaptureInfoLite | null; unfinished: CaptureInfoLite[] } {
  const mine = captures.filter((c) => rows.get(c.meetingId)?.nativeCapture === 1);
  const live = mine.find((c) => c.active) ?? null;
  const unfinished = mine.filter((c) => !c.active).sort((a, b) => a.startedAt - b.startedAt);
  return { live, unfinished };
}

/** The sample to start reading from: the page's own stored cursor (never behind what native released). */
export function resumeFrom(row: NativeRowInfo | undefined, info: Pick<CaptureInfoLite, "committed">): number {
  return Math.max(0, row?.nativeCursor ?? 0, info.committed ?? 0);
}
