import type { TranscriptPart } from "@/lib/transcript";
import { getLocalDb } from "./db";
import { computePending, emptyDirty, mergePulledMeeting, planMissing, shouldClearTail } from "./syncCore";
import type {
  LocalMeeting,
  NewLocalMeeting,
  ServerMeetingFull,
  ServerMeetingMeta,
  SyncResultPatch,
} from "./types";

// The only module that touches IndexedDB. No function throws: failures give false / null / [].

export function localAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let persistAsked = false;
export async function requestPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
}

export async function createLocal(userId: string, m: NewLocalMeeting): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    await db.transaction("rw", db.meetings, db.transcripts, async () => {
      if (await db.meetings.get(m.id)) return;
      const dirty = { ...emptyDirty(), create: true };
      await db.meetings.put({
        id: m.id,
        userId,
        title: m.title,
        titleUpdatedAt: null,
        language: m.language,
        engine: m.engine,
        deviceName: m.deviceName,
        status: "RECORDING",
        durationSec: 0,
        createdAt: m.createdAt ?? new Date().toISOString(),
        template: null,
        document: null,
        speakerNames: null,
        origin: m.origin,
        partsCount: 0,
        hasTranscript: true,
        savedParts: 0,
        localRev: 0,
        serverUpdatedAt: null,
        dirty,
        pending: computePending(dirty, 0),
        deleted: 0,
        syncError: null,
      });
      await db.transcripts.put({ id: m.id, parts: [] });
    });
    return true;
  } catch {
    return false;
  }
}

export async function putParts(
  userId: string,
  id: string,
  parts: TranscriptPart[],
  durationSec: number,
  status?: "DONE",
): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, db.transcripts, async () => {
      const row = await db.meetings.get(id);
      if (!row || row.deleted === 1) return false;
      const dirty = { ...row.dirty, tail: true };
      const next: LocalMeeting = {
        ...row,
        partsCount: parts.length,
        localRev: row.localRev + 1,
        durationSec,
        hasTranscript: true,
        dirty,
      };
      if (status === "DONE") {
        next.status = "DONE";
        dirty.finish = true;
      }
      next.pending = computePending(dirty, next.deleted);
      await db.transcripts.put({ id, parts });
      await db.meetings.put(next);
      return true;
    });
  } catch {
    return false;
  }
}

export async function mirrorNative(
  userId: string,
  id: string,
  parts: TranscriptPart[],
  durationSec: number,
  status: "RECORDING" | "DONE",
): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, db.transcripts, async () => {
      const row = await db.meetings.get(id);
      if (!row || row.deleted === 1) return false;
      await db.transcripts.put({ id, parts });
      await db.meetings.put({
        ...row,
        partsCount: parts.length,
        savedParts: parts.length,
        durationSec,
        status,
        hasTranscript: true,
      });
      return true;
    });
  } catch {
    return false;
  }
}

async function updateRow(
  userId: string,
  id: string,
  fn: (row: LocalMeeting) => LocalMeeting | null,
): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, async () => {
      const row = await db.meetings.get(id);
      if (!row) return false;
      const next = fn(row);
      if (!next) return false;
      next.pending = computePending(next.dirty, next.deleted);
      await db.meetings.put(next);
      return true;
    });
  } catch {
    return false;
  }
}

export function setTitle(userId: string, id: string, title: string): Promise<boolean> {
  return updateRow(userId, id, (r) =>
    r.deleted === 1
      ? null
      : { ...r, title, titleUpdatedAt: new Date().toISOString(), dirty: { ...r.dirty, meta: true } },
  );
}

export function setSpeakerNames(userId: string, id: string, names: Record<string, string>): Promise<boolean> {
  return updateRow(userId, id, (r) =>
    r.deleted === 1 ? null : { ...r, speakerNames: names, dirty: { ...r.dirty, speakers: true } },
  );
}

export function tombstone(userId: string, id: string): Promise<boolean> {
  return updateRow(userId, id, (r) => ({ ...r, deleted: 1 }));
}

export async function purge(userId: string, id: string): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    await db.transaction("rw", db.meetings, db.transcripts, async () => {
      await db.meetings.delete(id);
      await db.transcripts.delete(id);
    });
    return true;
  } catch {
    return false;
  }
}

export function setServerDocument(userId: string, id: string, document: string, template: string): Promise<boolean> {
  return updateRow(userId, id, (r) => ({ ...r, document, template }));
}

export async function cacheServerMeeting(userId: string, m: ServerMeetingFull): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    await db.transaction("rw", db.meetings, db.transcripts, async () => {
      const existing = await db.meetings.get(m.id);
      if (existing && existing.pending === 1) {
        await db.meetings.put({
          ...existing,
          document: m.document,
          template: m.template,
          serverUpdatedAt: m.updatedAt,
        });
        return;
      }
      const dirty = emptyDirty();
      await db.meetings.put({
        id: m.id,
        userId,
        title: m.title,
        titleUpdatedAt: m.titleUpdatedAt ?? existing?.titleUpdatedAt ?? null,
        language: m.language,
        engine: m.engine ?? existing?.engine ?? null,
        deviceName: m.deviceName,
        status: m.status === "DONE" ? "DONE" : "RECORDING",
        durationSec: m.durationSec,
        createdAt: m.createdAt,
        template: m.template,
        document: m.document,
        speakerNames: m.speakerNames ?? existing?.speakerNames ?? null,
        origin: existing?.origin ?? "server",
        partsCount: m.transcript.length,
        hasTranscript: true,
        savedParts: m.transcript.length,
        localRev: existing?.localRev ?? 0,
        serverUpdatedAt: m.updatedAt,
        dirty,
        pending: 0,
        deleted: existing?.deleted ?? 0,
        syncError: null,
      });
      await db.transcripts.put({ id: m.id, parts: m.transcript });
    });
    return true;
  } catch {
    return false;
  }
}

export async function getMeta(userId: string, id: string): Promise<LocalMeeting | null> {
  try {
    return (await getLocalDb(userId).meetings.get(id)) ?? null;
  } catch {
    return null;
  }
}

export async function getMeeting(
  userId: string,
  id: string,
): Promise<{ meeting: LocalMeeting; parts: TranscriptPart[] } | null> {
  try {
    const db = getLocalDb(userId);
    const [meeting, t] = await Promise.all([db.meetings.get(id), db.transcripts.get(id)]);
    if (!meeting) return null;
    return { meeting, parts: t?.parts ?? [] };
  } catch {
    return null;
  }
}

export async function getParts(
  userId: string,
  id: string,
): Promise<{ parts: TranscriptPart[]; localRev: number } | null> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("r", db.meetings, db.transcripts, async () => {
      const [meeting, t] = await Promise.all([db.meetings.get(id), db.transcripts.get(id)]);
      if (!meeting) return null;
      return { parts: t?.parts ?? [], localRev: meeting.localRev };
    });
  } catch {
    return null;
  }
}

export async function listMeetings(userId: string): Promise<LocalMeeting[]> {
  try {
    const rows = await getLocalDb(userId).meetings.where("deleted").equals(0).toArray();
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  } catch {
    return [];
  }
}

export async function listPending(userId: string): Promise<LocalMeeting[]> {
  try {
    const rows = await getLocalDb(userId).meetings.where("pending").equals(1).toArray();
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  } catch {
    return [];
  }
}

export async function applySyncResult(userId: string, id: string, r: SyncResultPatch): Promise<boolean> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, db.transcripts, async () => {
      const row = await db.meetings.get(id);
      if (!row) return false;
      const next: LocalMeeting = { ...row, dirty: { ...row.dirty } };
      if (r.savedParts !== undefined) next.savedParts = r.savedParts;
      if (r.title !== undefined) next.title = r.title;
      if (r.serverUpdatedAt !== undefined) next.serverUpdatedAt = r.serverUpdatedAt;
      if (r.syncError !== undefined) next.syncError = r.syncError;
      for (const k of r.markDirty ?? []) next.dirty[k] = true;
      for (const k of r.clear ?? []) {
        if (k === "tail") {
          if (shouldClearTail(r.readRev ?? -1, row.localRev, next.savedParts, row.partsCount)) next.dirty.tail = false;
        } else {
          next.dirty[k] = false;
        }
      }
      next.pending = computePending(next.dirty, next.deleted);
      await db.meetings.put(next);
      return true;
    });
  } catch {
    return false;
  }
}

export async function applyPull(userId: string, rows: ServerMeetingMeta[], ids: string[]): Promise<string[]> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, db.transcripts, async () => {
      const refetch: string[] = [];
      for (const s of rows) {
        const existing = await db.meetings.get(s.id);
        const res = mergePulledMeeting(existing, s, userId);
        if ((res.action === "insert" || res.action === "update") && res.next) await db.meetings.put(res.next);
        if (res.refetch) refetch.push(s.id);
      }
      const present = new Set(ids);
      for (const s of rows) present.add(s.id);
      const all = await db.meetings.where("deleted").equals(0).toArray();
      for (const local of all) {
        if (present.has(local.id)) continue;
        const plan = planMissing(local);
        if (plan === "remove") {
          await db.meetings.delete(local.id);
          await db.transcripts.delete(local.id);
        } else if (plan === "recreate") {
          const dirty = { ...local.dirty, create: true, tail: true };
          await db.meetings.put({ ...local, savedParts: 0, dirty, pending: computePending(dirty, local.deleted) });
        }
      }
      return refetch;
    });
  } catch {
    return [];
  }
}

export async function recoverOrphans(
  userId: string,
  isActive: (id: string) => boolean,
  createdBefore: number,
): Promise<number> {
  try {
    const db = getLocalDb(userId);
    return await db.transaction("rw", db.meetings, async () => {
      const rows = await db.meetings.where("status").equals("RECORDING").toArray();
      let n = 0;
      for (const r of rows) {
        if (r.origin !== "local" || r.deleted === 1) continue;
        if (!(Date.parse(r.createdAt) < createdBefore) || isActive(r.id)) continue;
        const dirty = { ...r.dirty, finish: true, tail: true };
        await db.meetings.put({
          ...r,
          status: "DONE",
          dirty,
          localRev: r.localRev + 1,
          pending: computePending(dirty, r.deleted),
        });
        n++;
      }
      return n;
    });
  } catch {
    return 0;
  }
}

export async function kvGet<T>(userId: string, key: string): Promise<T | undefined> {
  try {
    const row = await getLocalDb(userId).kv.get(key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(userId: string, key: string, value: unknown): Promise<boolean> {
  try {
    await getLocalDb(userId).kv.put({ key, value });
    return true;
  } catch {
    return false;
  }
}
