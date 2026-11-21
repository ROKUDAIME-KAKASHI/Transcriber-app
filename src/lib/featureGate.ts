import { useConnectivity } from "@/lib/connectivity";
import { useAuthStatus } from "@/lib/authStore";
import { gate, type Gate, type GateKind } from "@/lib/featureGateCore";

export * from "@/lib/featureGateCore";

export function useFeatureGate(kind: GateKind): Gate {
  const conn = useConnectivity();
  const auth = useAuthStatus();
  return gate(kind, { conn, auth });
}
