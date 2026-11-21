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
      return { state: { status: "offline", failures: Math.max(state.failures, 1) }, effect: null };
    case "hint-online":
    case "plugin-disconnected":
      return { state, effect: "probe-now" };
  }
}
