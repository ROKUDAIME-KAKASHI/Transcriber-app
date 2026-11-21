export type GateKind = "deepgram" | "ai";
export type Gate = { enabled: boolean; reason: string | null };
export type GateState = {
  conn: "online" | "offline" | "unknown";
  auth: "app" | "app-cached" | "other" | "needs-reauth";
};

export function gate(_kind: GateKind, s: GateState): Gate {
  if (s.auth === "needs-reauth") return { enabled: false, reason: "Sign in again to use this" };
  if (s.conn === "offline") return { enabled: false, reason: "Needs internet" };
  return { enabled: true, reason: null };
}

type EngineValue = "deepgram" | (string & {});

/** Pure: which engine to actually use. Never implies changing the saved preference. */
export function effectiveEngine(o: {
  saved: EngineValue;
  lastOnDevice: string | null;
  locked: boolean;
  deepgramEnabled: boolean;
}): string {
  if (o.locked) return o.saved;
  if (o.saved === "deepgram" && !o.deepgramEnabled) return o.lastOnDevice ?? "moonshine";
  return o.saved;
}
