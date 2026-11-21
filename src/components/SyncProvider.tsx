"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LAST_EMAIL_KEY, LAST_USER_KEY, useAuth } from "./AuthProvider";
import { setAuthStatus } from "@/lib/authStore";
import { localAvailable, recoverOrphans, requestPersist } from "@/lib/local/repo";
import { PAGE_LOADED_AT, getSyncSnapshot, isRecordingId, poke, resumeAuth, startSync, stopSync, subscribeSync } from "@/lib/local/sync";

interface LocalUser {
  userId: string | null;
  available: boolean;
}

const Ctx = createContext<LocalUser>({ userId: null, available: false });

/**
 * Call right before an explicit sign-out: forget the last user and stop the engine so nothing syncs
 * as the wrong user. The per-user IndexedDB is kept (unsynced data must survive sign-out, D-08).
 */
export function markSignedOut(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    localStorage.removeItem(LAST_EMAIL_KEY);
  } catch {
    /* ignore */
  }
  try {
    stopSync();
  } catch {
    /* ignore */
  }
}

export function useLocalUser(): LocalUser {
  return useContext(Ctx);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user: authUser, status } = useAuth();
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

  const sessionUserId = authUser?.id ?? null;
  const authedRef = useRef(false);
  authedRef.current = status === "authenticated";
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

  // A sync 401 means the session is gone: let useFeatureGate say "Sign in again to use this".
  useEffect(() => {
    let flagged = false;
    const check = () => {
      if (getSyncSnapshot().state === "needs-auth") {
        flagged = true;
        setAuthStatus("needs-reauth");
      } else if (flagged) {
        flagged = false;
        setAuthStatus(authedRef.current ? "app" : "other");
      }
    };
    check();
    return subscribeSync(check);
  }, []);

  const value = useMemo(() => ({ userId, available }), [userId, available]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
