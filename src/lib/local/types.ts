import type { TranscriptPart } from "@/lib/transcript";

export type LocalOrigin = "local" | "server" | "native";
export type DirtyKey = "create" | "tail" | "meta" | "speakers" | "finish";
export type DirtyFlags = Record<DirtyKey, boolean>;

export interface LocalMeeting {
  id: string;
  userId: string;
  title: string;
  titleUpdatedAt: string | null;
  language: string;
  engine: string | null;
  deviceName: string | null;
  status: "RECORDING" | "DONE";
  durationSec: number;
  createdAt: string;
  template: string | null;
  document: string | null;
  speakerNames: Record<string, string> | null;
  origin: LocalOrigin;
  partsCount: number;
  hasTranscript: boolean;
  savedParts: number;
  localRev: number;
  serverUpdatedAt: string | null;
  dirty: DirtyFlags;
  pending: 0 | 1;
  deleted: 0 | 1;
  syncError: string | null;
  /** Epoch ms of the last local transcript write; lets other tabs skip live recordings. */
  lastWriteAt?: number;
  /** Refined speaker labels waiting to be pushed through /speakers (no index). */
  relabelPending?: 0 | 1;
  /** Bumped on every local speaker-name/label change; sync clears the dirty flag only if unchanged. */
  speakersRev?: number;
  /** 1 while the Android app's native service holds audio for this meeting that the page has not finished transcribing. */
  nativeCapture?: 0 | 1;
  /** Sample (16 kHz) up to which the native audio is in the transcript; saved in the same transaction as the parts. */
  nativeCursor?: number;
}

/** Device-local speaker embedding for one transcript part (D-09: never synced). */
export interface LocalEmbedding {
  meetingId: string;
  part: number;
  vec: Float32Array;
  dur: number;
}

export interface LocalTranscript {
  id: string;
  parts: TranscriptPart[];
}

export interface KvRow {
  key: string;
  value: unknown;
}

export interface NewLocalMeeting {
  id: string;
  title: string;
  language: string;
  engine: string | null;
  deviceName: string | null;
  origin: "local" | "native";
  createdAt?: string;
  /** Recorded by the Android service into audio files (offline capture): see LocalMeeting.nativeCapture. */
  nativeCapture?: boolean;
}

export interface ServerMeetingMeta {
  id: string;
  title: string;
  status: string;
  language: string;
  durationSec: number;
  deviceName: string | null;
  template: string | null;
  createdAt: string;
  updatedAt: string;
  engine?: string | null;
  titleUpdatedAt?: string | null;
}

export interface ServerMeetingFull extends ServerMeetingMeta {
  document: string | null;
  transcript: TranscriptPart[];
  speakerNames?: Record<string, string> | null;
}

export interface SyncResultPatch {
  savedParts?: number;
  title?: string;
  serverUpdatedAt?: string;
  clear?: DirtyKey[];
  markDirty?: DirtyKey[];
  readRev?: number;
  syncError?: string | null;
  clearRelabel?: boolean;
  /** The speakersRev the request was built from; "speakers" and clearRelabel are cleared only if it still matches. */
  speakersRev?: number;
}

export interface MergeResult {
  action: "insert" | "update" | "skip";
  next?: LocalMeeting;
  refetch: boolean;
}
