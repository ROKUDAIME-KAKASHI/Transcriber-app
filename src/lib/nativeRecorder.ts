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
import { interpretCapabilities, NO_NATIVE_CAPABILITIES, type NativeCapabilities } from "@/lib/speech/nativeFeed";

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
  /** Newer APKs only. Missing means "cloud" (old APKs never send it). */
  mode?: "cloud" | "local";
  /** Local mode: samples (16 kHz) captured and flushed to disk so far. Same clock as `seconds`. */
  headSamples?: number;
  /** Local mode: the page's committed cursor (everything before it is transcribed and may be deleted). */
  committed?: number;
  /** Local mode: free bytes left where the audio is written. */
  freeBytes?: number;
  /** Local mode: why capture ended on its own ("storage" | "interrupted"), if it did. */
  stoppedReason?: string | null;
}

export interface NativeStartOptions {
  meetingId: string;
  language: string;
  /** Required for cloud mode only. */
  baseUrl?: string;
  /** "local" = record to files on the phone, no network. Old APKs ignore this: check capabilities() first. */
  mode?: "cloud" | "local";
  engine?: string;
}

export interface NativeCapabilitiesResult {
  version: number;
  localCapture: boolean;
  segmentSamples: number;
  sampleRate: number;
}

export interface NativeReadAudioResult {
  /** Absolute sample index of the first returned sample (echoes `from`). */
  from: number;
  samples: number;
  /** s16le mono 16 kHz, base64 (no wrap). Empty when samples is 0. */
  data: string;
  /** Samples flushed to disk so far. */
  head: number;
  /** Capture is over (stopped/interrupted) and from + samples >= head: nothing more will ever come. */
  ended: boolean;
  /** Sample indexes inside [from, from + samples) where a pause began. */
  breaks: number[];
}

export interface NativeCaptureInfo {
  meetingId: string;
  head: number;
  committed: number;
  state: "recording" | "stopped" | "interrupted";
  stoppedReason?: string | null;
  startedAt: number;
  engine: string;
  language: string;
  /** The service is capturing this meeting right now. */
  active: boolean;
}

interface MeetingRecorderPlugin {
  start(opts: NativeStartOptions): Promise<void>;
  stop(opts?: { force?: boolean }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(opts: { from: number }): Promise<NativeRecorderState>;
  batteryStatus(): Promise<{ unrestricted: boolean; manufacturer: string }>;
  requestUnrestrictedBattery(): Promise<void>;
  /** Newer APKs only; older ones reject with UNIMPLEMENTED (use nativeCapabilities()). */
  capabilities(): Promise<NativeCapabilitiesResult>;
  readAudio(opts: { meetingId: string; from: number; maxSamples: number }): Promise<NativeReadAudioResult>;
  releaseAudio(opts: { meetingId: string; before: number }): Promise<{ freedBytes: number }>;
  listCaptures(): Promise<{ captures: NativeCaptureInfo[] }>;
  discardCapture(opts: { meetingId: string }): Promise<void>;
}

export const MeetingRecorder = registerPlugin<MeetingRecorderPlugin>("MeetingRecorder");

/** True inside the Android app (with the native recorder available). */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("MeetingRecorder");
}

/** Deletes the audio the app kept for a meeting (best effort; a no-op on the website and old APKs). */
export async function discardNativeAudio(meetingId: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await MeetingRecorder.discardCapture({ meetingId });
  } catch {
    /* not there, still being recorded, or an old APK: nothing to do */
  }
}

let capsPromise: Promise<NativeCapabilities> | null = null;

/**
 * What this installed APK can do. Never throws: on the website it is "nothing", and on an old APK
 * (capabilities() is UNIMPLEMENTED) it is `{ localCapture: false, version: 1 }`, so callers keep the
 * web-microphone path. Cached for the page's lifetime.
 */
export function nativeCapabilities(): Promise<NativeCapabilities> {
  if (!isNativeApp()) return Promise.resolve(NO_NATIVE_CAPABILITIES);
  capsPromise ??= MeetingRecorder.capabilities().then(
    (r) => interpretCapabilities(r),
    () => interpretCapabilities(null, true),
  );
  return capsPromise;
}
