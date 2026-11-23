/**
 * The Android app's native recorder (android/app/src/main/java/in/transcriber/app/recorder).
 *
 * Inside the app, cloud recording runs in a foreground service instead of the web page: the
 * browser pauses a page's microphone when the screen locks, but a foreground service keeps going
 * for as long as the meeting lasts. The service streams to Deepgram and autosaves to the server by
 * itself; the page only reads its state (getState) to show it.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TranscriptPart } from "@/lib/transcript";

export interface NativeRecorderState {
  /** Recording or finishing. */
  active: boolean;
  paused: boolean;
  /** Stop was tapped; the last audio is still being sent or saved. */
  finishing: boolean;
  /** The last meeting is over (saved, unless saveState is "error"). */
  finished: boolean;
  meetingId: string | null;
  status: string;
  saveState: "idle" | "saving" | "saved" | "error";
  interim: string;
  noSound: boolean;
  /** Newer APKs only: the service stopped itself because the meeting was stopped from another device. */
  stoppedRemotely?: boolean;
  online: boolean;
  /** Seconds of audio waiting to be sent (after time offline). */
  backlogSeconds: number;
  level: number;
  seconds: number;
  partsCount: number;
  /** Index of parts[0] in the whole transcript. */
  from: number;
  parts: TranscriptPart[];
}

interface MeetingRecorderPlugin {
  start(opts: { meetingId: string; language: string; baseUrl: string }): Promise<void>;
  stop(opts?: { force?: boolean }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(opts: { from: number }): Promise<NativeRecorderState>;
  batteryStatus(): Promise<{ unrestricted: boolean; manufacturer: string }>;
  requestUnrestrictedBattery(): Promise<void>;
}

export const MeetingRecorder = registerPlugin<MeetingRecorderPlugin>("MeetingRecorder");

/** True inside the Android app (with the native recorder available). */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("MeetingRecorder");
}
