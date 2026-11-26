"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { markSignedOut } from "@/components/SyncProvider";
import { useRecorderActions } from "@/components/RecorderProvider";
import { cacheDisplayName } from "@/lib/displayName";
import { deleteLocalDb } from "@/lib/local/db";
import { isAccountLocalKey } from "@/lib/privacyCore";
import { isRecordingActive } from "@/lib/recordingFlag";

/** Removes this account's data from the device: IndexedDB and its localStorage keys. Model caches stay. */
async function wipeLocalData(userId: string): Promise<void> {
  markSignedOut(); // stops sync so nothing is pushed for the deleted account
  await deleteLocalDb(userId).catch(() => {});
  try {
    const dead: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isAccountLocalKey(k, userId)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  cacheDisplayName("");
}

/** Returns run(): null when it worked (the page is already on its way to /login), else the message to show. */
export function useDeleteAccount(userId: string | null): () => Promise<string | null> {
  const router = useRouter();
  const recorder = useRecorderActions();
  return useCallback(async () => {
    if (!userId) return "Couldn't tell which account this is. Sign in again.";
    // Same check as sign-out: a running recording would lose its sign-in.
    if (recorder?.isBusy() || (await isRecordingActive().catch(() => true))) return "Stop the recording before deleting your account.";
    try {
      const res = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        return d?.error || "Couldn't delete your account. Try again.";
      }
    } catch {
      return "Couldn't reach the server. Nothing was deleted.";
    }
    await wipeLocalData(userId);
    await signOut({ redirect: false }).catch(() => {});
    router.replace("/login?deleted=1");
    return null;
  }, [userId, router, recorder]);
}
