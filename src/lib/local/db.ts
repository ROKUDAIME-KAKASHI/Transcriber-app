import Dexie, { type EntityTable, type Table } from "dexie";
import type { KvRow, LocalEmbedding, LocalMeeting, LocalTranscript } from "./types";

/**
 * Per-user IndexedDB database (D-01). Transcript parts live in the sibling `transcripts` table,
 * one row per meeting, so list queries never deserialize big transcripts.
 */
export class LocalDb extends Dexie {
  meetings!: EntityTable<LocalMeeting, "id">;
  transcripts!: EntityTable<LocalTranscript, "id">;
  kv!: EntityTable<KvRow, "key">;
  embeddings!: Table<LocalEmbedding, [string, number]>;

  constructor(userId: string) {
    super("transcriber-" + userId);
    this.version(1).stores({
      meetings: "id, createdAt, status, origin, pending, deleted",
      transcripts: "id",
      kv: "key",
    });
    this.version(2).stores({ embeddings: "[meetingId+part], meetingId" });
  }
}

const cache = new Map<string, LocalDb>();

export function getLocalDb(userId: string): LocalDb {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  let db = cache.get(userId);
  if (!db) {
    db = new LocalDb(userId);
    cache.set(userId, db);
  }
  return db;
}
