import type { TranscriptPart } from "@/lib/transcript";
import type { DirtyFlags, LocalMeeting, MergeResult, ServerMeetingMeta } from "./types";

// Pure sync rules. Only type imports so Node's type stripping can run this in tests.

export const MAX_BATCH_PARTS = 2000;
export const MAX_BATCH_BYTES = 900_000;

export function nextTailBatch(
  parts: TranscriptPart[],
  savedParts: number,
  maxParts: number = MAX_BATCH_PARTS,
  maxBytes: number = MAX_BATCH_BYTES,
): { from: number; parts: TranscriptPart[]; end: number; done: boolean } {
  const from = Math.max(0, Math.min(savedParts - 1, parts.length));
  let bytes = 0;
  let end = from;
  while (end < parts.length && end - from < maxParts) {
    const cost = parts[end].text.length * 3 + 40;
    if (end > from && bytes + cost > maxBytes) break;
    bytes += cost;
    end++;
  }
  return { from, parts: parts.slice(from, end), end, done: end >= parts.length };
}

export type ResponseClass = "ok" | "auth" | "conflict" | "too-large" | "not-found" | "bad-request" | "retry";

export function classifyResponse(status: number | null): ResponseClass {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 409) return "conflict";
  if (status === 413) return "too-large";
  if (status === 404) return "not-found";
  if (status === 400 || status === 422) return "bad-request";
  return "retry";
}

export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(60_000, 2000 * Math.pow(2, Math.max(0, attempt)));
  const jitter = 1 + (rand() * 2 - 1) * 0.2;
  return Math.min(60_000, Math.round(base * jitter));
}

export function emptyDirty(): DirtyFlags {
  return { create: false, tail: false, meta: false, speakers: false, finish: false };
}

export function computePending(dirty: DirtyFlags, deleted: 0 | 1): 0 | 1 {
  if (deleted === 1) return 1;
  return dirty.create || dirty.tail || dirty.meta || dirty.speakers || dirty.finish ? 1 : 0;
}

export function shouldClearTail(readRev: number, currentRev: number, savedParts: number, partsCount: number): boolean {
  return readRev === currentRev && savedParts >= partsCount;
}

function ts(v: string | null | undefined): number {
  if (!v) return -Infinity;
  const n = Date.parse(v);
  return Number.isNaN(n) ? -Infinity : n;
}

export function mergePulledMeeting(
  local: LocalMeeting | undefined,
  server: ServerMeetingMeta,
  userId: string,
): MergeResult {
  const serverStatus: "RECORDING" | "DONE" = server.status === "DONE" ? "DONE" : "RECORDING";
  if (!local) {
    const dirty = emptyDirty();
    return {
      action: "insert",
      refetch: false,
      next: {
        id: server.id,
        userId,
        title: server.title,
        titleUpdatedAt: server.titleUpdatedAt ?? null,
        language: server.language,
        engine: server.engine ?? null,
        deviceName: server.deviceName,
        status: serverStatus,
        durationSec: server.durationSec,
        createdAt: server.createdAt,
        template: server.template,
        document: null,
        speakerNames: null,
        origin: "server",
        partsCount: 0,
        hasTranscript: false,
        savedParts: 0,
        localRev: 0,
        serverUpdatedAt: server.updatedAt,
        dirty,
        pending: 0,
        deleted: 0,
        syncError: null,
      },
    };
  }
  if (local.deleted === 1) return { action: "skip", refetch: false };

  const next: LocalMeeting = { ...local, dirty: { ...local.dirty } };
  next.template = server.template;

  // Title last-writer-wins.
  if (local.dirty.meta && ts(local.titleUpdatedAt) > ts(server.titleUpdatedAt)) {
    // keep local title and dirty.meta
  } else {
    next.title = server.title;
    next.titleUpdatedAt = server.titleUpdatedAt ?? local.titleUpdatedAt;
    next.dirty.meta = false;
  }

  const native = local.origin === "native";
  if (native ? serverStatus === "DONE" : !local.dirty.tail && !local.dirty.finish) {
    next.status = serverStatus;
    next.durationSec = server.durationSec;
  }
  if (local.dirty.create) next.dirty.create = false;

  const newer = ts(server.updatedAt) > ts(local.serverUpdatedAt);
  const refetch =
    newer && local.hasTranscript && !local.dirty.tail && !(native && serverStatus !== "DONE");
  // Keep the old cursor while a refetch is owed, so a failed refetch is retried on the next pull.
  next.serverUpdatedAt = refetch ? local.serverUpdatedAt : server.updatedAt;
  next.pending = computePending(next.dirty, next.deleted);

  const changed = JSON.stringify(next) !== JSON.stringify(local);
  return { action: changed ? "update" : "skip", next, refetch };
}

export function planMissing(local: LocalMeeting): "keep" | "remove" | "recreate" {
  if (local.dirty.create) return "keep";
  if (local.pending === 1) return "recreate";
  return "remove";
}

export const MAX_SPEAKER_PARTS = 60_000;

export type SpeakersRequest =
  | { path: "speakers"; body: { parts: { index: number; speaker: number }[]; speakerNames: Record<string, string> } }
  | { path: "meeting"; body: { speakerNames: Record<string, string> } };

/** Decides names-only PATCH /api/meetings/:id vs parts overrides via /speakers (trap 3). */
export function speakersRequest(a: {
  relabelPending: boolean;
  native: boolean;
  speakerNames: Record<string, string> | null;
  parts: { speaker: number }[] | null;
}): SpeakersRequest {
  const speakerNames = a.speakerNames ?? {};
  if (!a.relabelPending || a.native || !a.parts) return { path: "meeting", body: { speakerNames } };
  return {
    path: "speakers",
    body: {
      parts: a.parts.slice(0, MAX_SPEAKER_PARTS).map((p, index) => ({ index, speaker: p.speaker })),
      speakerNames,
    },
  };
}
