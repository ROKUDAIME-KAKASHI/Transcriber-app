import { MeetingRecorder } from "@/lib/nativeRecorder";
import { hasPlugin } from "@/lib/native";

let webRecording = false;

export function setWebRecording(v: boolean): void {
  webRecording = v;
}

export async function isRecordingActive(): Promise<boolean> {
  if (webRecording) return true;
  if (hasPlugin("MeetingRecorder")) {
    try {
      // from beyond parts.size copies zero parts, so this is cheap
      return (await MeetingRecorder.getState({ from: 1_000_000_000 })).active;
    } catch {
      // Unknown state: assume recording so back minimizes instead of exiting.
      return true;
    }
  }
  return false;
}
