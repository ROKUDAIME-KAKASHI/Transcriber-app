// Pure feature-switch registry. No imports so node tests can load it directly.
// A flag without a database row uses its default here. Add new switches to this one table.

export const FLAG_DEFAULTS = {
  actionItems: true,
  taskTracker: true,
  followUpAgenda: true,
  scheduling: true,
  nameSuggestions: true,
  offlineLockedRecording: true,
  stakeholders: true,
} as const;

export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type Flags = Record<FlagKey, boolean>;

export const FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as FlagKey[];

export const FLAG_LABELS: Record<FlagKey, string> = {
  actionItems: "Action items tab on meetings",
  taskTracker: "Task tracker (Tasks page)",
  followUpAgenda: "Follow-up agenda button",
  scheduling: "Scheduling (Schedule page and /book pages)",
  nameSuggestions: "Speaker name suggestions",
  offlineLockedRecording: "Offline recording with the screen locked (Android app)",
  stakeholders: "People directory (People page and person pickers)",
};

export function isFlagKey(k: unknown): k is FlagKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, k);
}

export function defaultFlags(): Flags {
  return { ...FLAG_DEFAULTS };
}

/** Defaults overlaid with stored rows. Unknown keys and non-boolean values are ignored. */
export function mergeFlags(rows: ReadonlyArray<{ key: string; enabled: unknown }> | null | undefined): Flags {
  const out = defaultFlags();
  for (const r of rows ?? []) {
    if (isFlagKey(r?.key) && typeof r.enabled === "boolean") out[r.key] = r.enabled;
  }
  return out;
}

/** Parses a cached or fetched flags object (localStorage, /api/flags). Never throws. */
export function parseFlags(x: unknown): Flags {
  if (!x || typeof x !== "object") return defaultFlags();
  const o = x as Record<string, unknown>;
  return mergeFlags(Object.entries(o).map(([key, enabled]) => ({ key, enabled })));
}
