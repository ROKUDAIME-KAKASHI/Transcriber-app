export type ConnStatus = "online" | "offline" | "unknown";
export type ConnState = { status: ConnStatus; failures: number };
export type ConnEvent =
  | { type: "probe-ok" }
  | { type: "probe-fail"; navigatorOnLine: boolean }
  | { type: "hint-online" }
  | { type: "hint-offline" }
  | { type: "plugin-disconnected" };
export type ConnEffect = null | "probe-now" | "retry-probe";

export const INITIAL_CONN: ConnState = { status: "unknown", failures: 0 };

/** Pure reachability reducer. One failed probe is retried before flipping to offline. */
export function reduce(state: ConnState, event: ConnEvent): { state: ConnState; effect: ConnEffect } {
  switch (event.type) {
    case "probe-ok":
      return { state: { status: "online", failures: 0 }, effect: null };
    case "probe-fail": {
      if (!event.navigatorOnLine || state.failures >= 1) {
        return { state: { status: "offline", failures: state.failures + 1 }, effect: null };
      }
      return { state: { status: state.status, failures: state.failures + 1 }, effect: "retry-probe" };
    }
    case "hint-offline":
      // Android fires "offline" while handing over between mobile networks (5G/LTE/IMS), even though the
      // internet still works. Treat it as "check now", never as proof: a real outage fails the probe at once
      // (fetch rejects with navigator.onLine false) and flips to offline through "probe-fail".
      return { state, effect: "probe-now" };
    case "hint-online":
    case "plugin-disconnected":
      return { state, effect: "probe-now" };
  }
}
