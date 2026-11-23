/** Calm mode: stop decorative animation during long recordings, on low battery or when the page is hidden. */
export const CALM_AFTER_SEC = 600;
export const CALM_BOOST_MS = 60000;

export type CalmInput = {
  recording: boolean;
  paused: boolean;
  seconds: number;
  reduced: boolean;
  hidden: boolean;
  lowBattery: boolean;
  boostUntil: number;
  now: number;
};

export type CalmResult = "idle" | "live" | "paused" | "calm" | "reduced";

export function calmMode(i: CalmInput): CalmResult {
  if (!i.recording) return i.reduced ? "reduced" : "idle";
  if (i.reduced) return "reduced";
  if (i.paused) return "paused";
  if (i.hidden) return "calm";
  if (i.boostUntil > i.now) return "live";
  if (i.seconds >= CALM_AFTER_SEC || i.lowBattery) return "calm";
  return "live";
}
