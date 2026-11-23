"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setAuthStatus } from "@/lib/authStore";
import { useConnectivity } from "@/lib/connectivity";
import { isStaleProbe, type Probe } from "@/lib/authCore";

export const LAST_USER_KEY = "transcriber.lastUserId";
export const LAST_EMAIL_KEY = "transcriber.lastUserEmail";

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState = "loading" | "authenticated" | "unauthenticated" | "unreachable";

interface AuthCtx {
  probe: Probe;
  status: AuthState;
  user: AuthUser | null;
  cachedUser: AuthUser | null;
  probing: boolean;
  /** Forces a fresh session probe (discarding any older in-flight one) and resolves with its outcome. */
  recheck: () => Promise<Probe>;
}

const Ctx = createContext<AuthCtx>({
  probe: "pending",
  status: "loading",
  user: null,
  cachedUser: null,
  probing: false,
  recheck: async () => "pending",
});

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}

type ProbeResult = { probe: "ok-user"; user: AuthUser } | { probe: "ok-empty" } | { probe: "unreachable" };

/** Network failure, timeout, non-OK or non-JSON (captive portal) is "unreachable", never a sign-out. */
async function runProbe(): Promise<ProbeResult> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { probe: "unreachable" };
    const json = await res.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) return { probe: "unreachable" };
    if (Object.keys(json).length === 0) return { probe: "ok-empty" };
    const u = (json as { user?: { id?: string; email?: string } }).user;
    if (!u || !u.id) return { probe: "ok-empty" };
    return { probe: "ok-user", user: { id: String(u.id), email: String(u.email ?? "") } };
  } catch {
    return { probe: "unreachable" };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [probe, setProbe] = useState<Probe>("pending");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cachedUser, setCachedUser] = useState<AuthUser | null>(null);
  const [probing, setProbing] = useState(false);
  const probeRef = useRef<Probe>("pending");
  const wasAuthed = useRef(false);
  const inflight = useRef(false);
  const gen = useRef(0);
  const conn = useConnectivity();

  const run = useCallback(async (force = false): Promise<Probe> => {
    if (inflight.current && !force) return probeRef.current;
    // A forced probe (after sign-in) supersedes any older one, whose late "no session" answer would
    // otherwise bounce the user straight back to /login.
    const myGen = ++gen.current;
    inflight.current = true;
    setProbing(true);
    const r = await runProbe();
    if (isStaleProbe(myGen, gen.current)) return probeRef.current;
    inflight.current = false;
    setProbing(false);
    if (r.probe === "ok-user") {
      wasAuthed.current = true;
      probeRef.current = "ok-user";
      setProbe("ok-user");
      setUser(r.user);
      setCachedUser(r.user);
      try {
        localStorage.setItem(LAST_USER_KEY, r.user.id);
        localStorage.setItem(LAST_EMAIL_KEY, r.user.email);
      } catch {
        /* ignore */
      }
    } else if (r.probe === "ok-empty") {
      probeRef.current = "ok-empty";
      setProbe("ok-empty");
      setUser(null);
    } else if (probeRef.current !== "ok-user") {
      // A failed probe after a good one keeps the signed-in state: a network error is not a sign-out.
      probeRef.current = "unreachable";
      setProbe("unreachable");
    }
    return probeRef.current;
  }, []);

  useEffect(() => {
    try {
      const id = localStorage.getItem(LAST_USER_KEY);
      if (id) setCachedUser({ id, email: localStorage.getItem(LAST_EMAIL_KEY) ?? "" });
    } catch {
      /* ignore */
    }
    void run();
  }, [run]);

  // Re-probe on offline-to-online and when the app comes back to the foreground.
  const prevConn = useRef(conn);
  useEffect(() => {
    if (prevConn.current === "offline" && conn === "online") void run();
    prevConn.current = conn;
  }, [conn, run]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (probeRef.current === "ok-user" && conn === "online") return;
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [conn, run]);

  useEffect(() => {
    if (probe === "ok-user") setAuthStatus("app");
    else if (probe === "unreachable" && cachedUser) setAuthStatus("app-cached");
    else if (probe === "ok-empty" && wasAuthed.current) setAuthStatus("needs-reauth");
    else setAuthStatus("other");
  }, [probe, cachedUser]);

  const status: AuthState =
    probe === "ok-user" ? "authenticated" : probe === "ok-empty" ? "unauthenticated" : probe === "unreachable" ? "unreachable" : "loading";

  const value = useMemo(
    () => ({ probe, status, user, cachedUser, probing, recheck: () => run(true) }),
    [probe, status, user, cachedUser, probing, run]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
