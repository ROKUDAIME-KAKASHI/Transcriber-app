/** Pure helpers for the tabs on the meeting page. No imports, so node:test can load them. */

export type TabId = "transcript" | "minutes" | "actions" | "ask";

export const TAB_STORAGE_KEY = "minutely.meetingTab";

export const TAB_LABELS: Record<TabId, string> = {
  transcript: "Transcript",
  minutes: "Summary & minutes",
  actions: "Action items",
  ask: "Ask",
};

/** Tab order with the switch on: what people want after a meeting comes first. */
const ALL: TabId[] = ["minutes", "actions", "transcript", "ask"];

export function isTabId(v: unknown): v is TabId {
  return typeof v === "string" && (ALL as string[]).includes(v);
}

/** Tabs to show, in order. `actions` follows the action-items switch, `ask` the Ask switch. */
export function visibleTabs(o: { tabs: boolean; actions: boolean; ask: boolean }): TabId[] {
  if (!o.tabs) {
    // The page as it was before tabs: Minutes, Transcript and (switch permitting) Action items.
    return ["minutes", "transcript", ...(o.actions ? (["actions"] as TabId[]) : [])];
  }
  return ALL.filter((t) => (t === "actions" ? o.actions : t === "ask" ? o.ask : true));
}

/** `?tab=` value to a tab; "summary" (now folded into Minutes), "document" and "tasks" are accepted as older names. */
export function parseTabParam(v: string | null | undefined): TabId | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t === "document" || t === "mom" || t === "summary") return "minutes";
  if (t === "tasks" || t === "action-items" || t === "actions") return "actions";
  return isTabId(t) ? t : null;
}

/** Which tab opens first: the link, else the last one used on this device, else action items when there are any, else minutes when there are some, else the transcript. */
export function pickInitialTab(o: {
  param: string | null | undefined;
  saved: string | null | undefined;
  hasDoc: boolean;
  hasActions?: boolean;
  visible: readonly TabId[];
}): TabId {
  for (const c of [parseTabParam(o.param), parseTabParam(o.saved)]) {
    if (c && o.visible.includes(c)) return c;
  }
  const fallback: TabId = o.hasActions && o.visible.includes("actions") ? "actions" : o.hasDoc ? "minutes" : "transcript";
  return o.visible.includes(fallback) ? fallback : o.visible[0];
}

/** The search string with `tab` set, every other parameter (e.g. `id`) kept. Takes and returns "?a=b" or "". */
export function withTabParam(search: string, tab: TabId): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  p.set("tab", tab);
  return `?${p.toString()}`;
}

/** Arrow / Home / End navigation within the tab list. Returns null for other keys. */
export function nextTab(visible: readonly TabId[], current: TabId, key: string): TabId | null {
  const i = visible.indexOf(current);
  if (i < 0 || visible.length === 0) return null;
  const n = visible.length;
  if (key === "ArrowRight" || key === "ArrowDown") return visible[(i + 1) % n];
  if (key === "ArrowLeft" || key === "ArrowUp") return visible[(i - 1 + n) % n];
  if (key === "Home") return visible[0];
  if (key === "End") return visible[n - 1];
  return null;
}
