import { useSyncExternalStore } from "react";

export type AuthStatus = "app" | "app-cached" | "other" | "needs-reauth";

let status: AuthStatus = "other";
const listeners = new Set<() => void>();

export function setAuthStatus(s: AuthStatus): void {
  if (s === status) return;
  status = s;
  for (const l of listeners) l();
}

export function getAuthStatus(): AuthStatus {
  return status;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useAuthStatus(): AuthStatus {
  return useSyncExternalStore(subscribe, getAuthStatus, () => "other" as AuthStatus);
}
