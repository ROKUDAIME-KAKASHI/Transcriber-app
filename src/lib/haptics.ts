import { hasPlugin } from "@/lib/native";

/**
 * Haptic feedback. Native Android builds with the plugin only; a silent no-op on the website
 * and on old APKs. Never throws and never leaves an unhandled rejection.
 */
type Kind = "tap" | "start" | "stop" | "success" | "warn";

function fire(kind: Kind): void {
  try {
    if (!hasPlugin("Haptics")) return;
    void import("@capacitor/haptics")
      .then(({ Haptics, ImpactStyle, NotificationType }) => {
        switch (kind) {
          case "tap":
            return Haptics.impact({ style: ImpactStyle.Light });
          case "start":
          case "stop":
            return Haptics.impact({ style: ImpactStyle.Medium });
          case "success":
            return Haptics.notification({ type: NotificationType.Success });
          case "warn":
            return Haptics.notification({ type: NotificationType.Warning });
        }
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

export function tap(): void {
  fire("tap");
}
export function start(): void {
  fire("start");
}
export function stop(): void {
  fire("stop");
}
export function success(): void {
  fire("success");
}
export function warn(): void {
  fire("warn");
}
