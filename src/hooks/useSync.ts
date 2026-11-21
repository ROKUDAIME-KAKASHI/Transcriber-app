"use client";

import { useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocalUser } from "@/components/SyncProvider";
import { getMeta } from "@/lib/local/repo";
import { getSyncSnapshot, subscribeSync, type SyncSnapshot } from "@/lib/local/sync";

const SERVER_SNAPSHOT: SyncSnapshot = { state: "idle", userId: null, lastSyncedAt: null, lastError: null };

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, () => SERVER_SNAPSHOT);
}

export type MeetingSyncState = "none" | "synced" | "saving" | "waiting" | "needs-auth" | "conflict";

export function useMeetingSync(id: string | null): MeetingSyncState {
  const { userId } = useLocalUser();
  const snap = useSyncStatus();
  const meta = useLiveQuery(() => (userId && id ? getMeta(userId, id) : null), [userId, id], undefined);
  if (!id || !meta) return "none";
  if (meta.syncError === "conflict") return "conflict";
  if (meta.pending === 0) return "synced";
  if (snap.state === "needs-auth") return "needs-auth";
  if (snap.state === "offline") return "waiting";
  return "saving";
}
