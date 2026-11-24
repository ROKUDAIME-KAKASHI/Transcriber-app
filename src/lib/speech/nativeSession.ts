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
): { live: CaptureInfoLite | null; unfinished: CaptureInfoLite[]; orphans: CaptureInfoLite[] } {
  const mine = captures.filter((c) => rows.get(c.meetingId)?.nativeCapture === 1);
  const live = mine.find((c) => c.active) ?? null;
  const unfinished = mine.filter((c) => !c.active).sort((a, b) => a.startedAt - b.startedAt);
  // Left behind by a crash between the write that finished the meeting and the delete: the meeting is DONE
  // here and no longer claims the audio. (A folder with no row at all is never touched.)
  const orphans = captures.filter((c) => {
    const row = rows.get(c.meetingId);
    return !c.active && !!row && row.nativeCapture !== 1 && row.status === "DONE";
  });
  return { live, unfinished, orphans };
}

function mmss(samples: number): string {
  const total = Math.max(0, Math.floor(samples / 16000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** What to tell the user when a capture left on the phone is being finished (the app was reopened). */
export function recoveryNote(c: Pick<CaptureInfoLite, "state" | "stoppedReason" | "head">): string {
  if (c.stoppedReason === "storage") {
    return `Recording stopped at ${mmss(c.head)} because the phone ran out of storage. Transcribing what was recorded.`;
  }
  if (c.state === "interrupted" || c.stoppedReason === "interrupted") {
    return `Recording was stopped by Android at ${mmss(c.head)}. Transcribing what was recorded.`;
  }
  return "Recording had stopped. Transcribing what was recorded.";
}

const BYTES_PER_HOUR = 16000 * 2 * 3600;

/** A heads-up about phone storage while recording, or after the service stopped because of it. */
export function storageNotice(a: {
  freeBytes?: number | null;
  stoppedReason?: string | null;
}): { tone: "warning" | "danger"; text: string } | null {
  if (a.stoppedReason === "storage") {
    return {
      tone: "danger",
      text: "Recording stopped because the phone is almost out of storage. What was recorded is being transcribed. Free up some space before you record again.",
    };
  }
  const free = a.freeBytes;
  if (typeof free !== "number" || free < 0 || free >= BYTES_PER_HOUR) return null;
  const minutes = Math.max(1, Math.floor(free / 32000 / 60));
  return {
    tone: "warning",
    text: `The phone is running low on storage: about ${minutes} min of recording space left. Free up some space to keep recording.`,
  };
}

/** The sample to start reading from: the page's own stored cursor (never behind what native released). */
export function resumeFrom(row: NativeRowInfo | undefined, info: Pick<CaptureInfoLite, "committed">): number {
  return Math.max(0, row?.nativeCursor ?? 0, info.committed ?? 0);
}
