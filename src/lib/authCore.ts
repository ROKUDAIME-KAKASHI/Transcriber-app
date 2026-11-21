export type Probe = "ok-user" | "ok-empty" | "unreachable" | "pending";
export type AuthDecision = "skeleton" | "app" | "app-cached" | "needs-internet" | "redirect-login";

export const PENDING_GRACE_MS = 6000;

export function decideAuth(a: { probe: Probe; cached: boolean; waitedMs: number }): AuthDecision {
  switch (a.probe) {
    case "ok-user":
      return "app";
    case "ok-empty":
      return "redirect-login";
    case "unreachable":
      return a.cached ? "app-cached" : "needs-internet";
    case "pending":
      if (a.waitedMs <= PENDING_GRACE_MS) return "skeleton";
      return a.cached ? "app-cached" : "needs-internet";
  }
}
