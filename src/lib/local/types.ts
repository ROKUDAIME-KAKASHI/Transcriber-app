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
}

export interface MergeResult {
  action: "insert" | "update" | "skip";
  next?: LocalMeeting;
  refetch: boolean;
}
