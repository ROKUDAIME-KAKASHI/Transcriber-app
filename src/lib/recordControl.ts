/** Pure helpers for the Record screen: which state the control is in, the input status lines, and auto-follow. */

export type RecordControlState = "ready" | "starting" | "recording" | "paused" | "saving" | "saved" | "error";

export interface RecordControlInput {
  busy: boolean;
  paused: boolean;
  starting: boolean;
  finishing?: boolean;
  saveState: "idle" | "saving" | "saved" | "local" | "error";
  meetingId: string | null;
  hasTranscript: boolean;
  statusMsg: string;
}

/** Messages the hook leaves behind when nothing went wrong. */
const QUIET_MESSAGES = new Set(["", "Ready", "Cancelled."]);
const FAILURE_RE = /\b(couldn['’]?t|could not|can['’]?t|cannot|error|failed|denied|not allowed|blocked|unable|no (microphone|computer sound|audio))\b/i;

/** Maps the recorder's existing state to one of the control's looks. The hook is not changed; this only reads it. */
export function recordControlState(i: RecordControlInput): RecordControlState {
  if (i.starting) return "starting";
  if (i.busy) return i.paused ? "paused" : "recording";
  if (i.finishing || i.saveState === "saving") return "saving";
  if (i.meetingId && i.hasTranscript && (i.saveState === "saved" || i.saveState === "local" || i.saveState === "error")) return "saved";
  // Only real failures read as errors; other leftover status text (e.g. "Model loaded") stays "ready".
  const msg = i.statusMsg.trim();
  if (i.saveState === "idle" && !QUIET_MESSAGES.has(msg) && FAILURE_RE.test(msg)) return "error";
  return "ready";
}

export const RECORD_CONTROL_LABEL: Record<RecordControlState, string> = {
  ready: "Ready",
  starting: "Getting ready",
  recording: "Recording",
  paused: "Paused",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't record",
};

export interface InputStatusInput {
  state: RecordControlState;
  /** Chosen microphone's name; empty for the default. */
  micLabel: string;
  /** The phone's own microphone (native app). */
  phoneMic: boolean;
  /** Whether the "computer sound" toggle exists on this device. */
  soundToggle: boolean;
  soundOn: boolean;
}

/** "Microphone: Default · active", "Computer sound: on". */
export function inputStatusLines(i: InputStatusInput): string[] {
  const device = i.phoneMic ? "Phone microphone" : i.micLabel.trim() || "Default";
  const suffix = i.state === "recording" ? "active" : i.state === "paused" ? "paused" : i.state === "starting" ? "starting" : "ready";
  const lines = [`Microphone: ${device} · ${suffix}`];
  if (i.soundToggle) lines.push(`Computer sound: ${i.soundOn ? "on" : "off"}`);
  return lines;
}

const NEAR_BOTTOM_PX = 48;

/** True when the scroll box is within a few pixels of its end. */
export function isNearBottom(m: { scrollTop: number; clientHeight: number; scrollHeight: number }, threshold = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

/**
 * Whether the transcript should keep following new lines after a scroll event.
 * Reaching the bottom always resumes following; leaving it only stops following when the user did it
 * (touch, wheel or key), so the page's own smooth scrolling never turns it off.
 */
export function followAfterScroll(prev: boolean, nearBottom: boolean, userInitiated: boolean): boolean {
  if (nearBottom) return true;
  return userInitiated ? false : prev;
}

/** Show "Jump to latest" while recording with following off. */
export function showJumpToLatest(recording: boolean, following: boolean): boolean {
  return recording && !following;
}
