"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { localAvailable, recoverOrphans, requestPersist } from "@/lib/local/repo";
import { PAGE_LOADED_AT, isRecordingId, poke, resumeAuth, startSync, stopSync } from "@/lib/local/sync";

interface LocalUser {
  userId: string | null;
  available: boolean;
}

const Ctx = createContext<LocalUser>({ userId: null, available: false });
const LAST_USER_KEY = "transcriber.lastUserId";

export function useLocalUser(): LocalUser {
  return useContext(Ctx);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();
  const [lastUserId, setLastUserId] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    try {
      setLastUserId(localStorage.getItem(LAST_USER_KEY));
    } catch {
      /* ignore */
    }
    setAvailable(localAvailable());
  }, []);

  const sessionUserId = data?.user?.id ?? null;
  useEffect(() => {
    if (status === "authenticated" && sessionUserId) {
      try {
        localStorage.setItem(LAST_USER_KEY, sessionUserId);
      } catch {
        /* ignore */
      }
    }
  }, [status, sessionUserId]);

  // Session loading or a failed session fetch must not hide the local DB; an authenticated id always wins.
  const userId = sessionUserId ?? lastUserId;

  useEffect(() => {
    if (!userId || !available) return;
    startSync(userId);
    void requestPersist();
    void recoverOrphans(userId, isRecordingId, PAGE_LOADED_AT).then(() => poke());
    return () => stopSync();
  }, [userId, available]);

  useEffect(() => {
    if (status === "authenticated") resumeAuth();
  }, [status]);

  const value = useMemo(() => ({ userId, available }), [userId, available]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
