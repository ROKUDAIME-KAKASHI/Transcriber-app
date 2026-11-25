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
  plannedMeetings: true,
  prework: true,
  calendar: true,
  trackerPlus: true,
  followUpPlanning: true,
  tabAudio: true,
  meetingTabs: true,
  autoMinutes: true,
  meetingAsk: true,
  guidedCall: true,
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
  plannedMeetings: "Planned meetings and series (Plan page, Upcoming list)",
  prework: "Pre-work: reference files and AI agenda points on plans",
  calendar: "Calendar: free/busy sharing, Find a time, series auto-planning, email invites",
  trackerPlus: "Tracker upgrades: owners from People, timeline, overdue alerts, series progress",
  followUpPlanning: "Plan next meeting: carries unfinished tasks into the next planned meeting",
  tabAudio: "Record online calls from a browser tab (laptops)",
  meetingTabs: "Meeting page tabs: Transcript, Minutes, Summary, Action items, Ask",
  autoMinutes: "Write minutes, summary and action items automatically after Stop (one small AI request; costs credits)",
  meetingAsk: "Ask tab: questions about a meeting, answered with quotes (small AI request per question)",
  guidedCall: "Record an online call: picture guide, wrong-choice and no-sound warnings, open the call from Minutely (laptops)",
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
