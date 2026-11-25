// Per-meeting naming statistics for the owner's accuracy check. Kept on this device only (never sent anywhere)
// and rendered as plain text for "Copy report". Pure, erasable TypeScript only.

import { remapNames } from "../speech/diarize.ts";

export interface AutoEntry {
  cluster: number;
  name: string;
  level: "probable" | "confirmed";
  source: "screen" | "me";
  /** How many agreeing reads backed it when last updated. */
  reads: number;
  /** The user renamed it later. */
  changedTo?: string;
}

export interface NamingStats {
  v: 1;
  platform: string | null;
  startedAt: number;
  /** Voices heard in the meeting (set at the end). */
  clusters: number;
  /** OCR attempts, and how each went. */
  reads: number;
  usable: number;
  rejected: number;
  noTile: number;
  failed: number;
  ring: number;
  speakerView: number;
  auto: AutoEntry[];
}

export function newStats(platform: string | null, now: number): NamingStats {
  return { v: 1, platform, startedAt: now, clusters: 0, reads: 0, usable: 0, rejected: 0, noTile: 0, failed: 0, ring: 0, speakerView: 0, auto: [] };
}

export function setAuto(s: NamingStats, e: Omit<AutoEntry, "changedTo">): void {
  const i = s.auto.findIndex((a) => a.cluster === e.cluster);
  if (i >= 0) s.auto[i] = { ...e, changedTo: s.auto[i].changedTo };
  else s.auto.push({ ...e });
}

/** The user typed a name for a voice. Counts as a change when the voice had an automatic name that differs. */
export function noteRename(s: NamingStats, cluster: number, newName: string): boolean {
  const a = s.auto.find((x) => x.cluster === cluster);
  if (!a) return false;
  const next = newName.trim();
  const was = (a.changedTo ?? a.name).trim();
  if (next.toLowerCase() === was.toLowerCase()) return false;
  if (next.toLowerCase() === a.name.trim().toLowerCase()) {
    delete a.changedTo; // put back to the automatic name
    return true;
  }
  a.changedTo = next; // an empty name means the user cleared it, which also counts
  return true;
}

/** After the stop-time re-clustering: moves entries to the voice numbers the transcript now uses. */
export function remapStats(s: NamingStats, live: number[], final: number[]): NamingStats {
  const asNames: Record<string, string> = {};
  for (const a of s.auto) asNames[String(a.cluster)] = a.name;
  const moved = remapNames(asNames, live, final);
  const auto: AutoEntry[] = [];
  for (const [k, name] of Object.entries(moved)) {
    const old = s.auto.find((a) => a.name === name);
    if (old) auto.push({ ...old, cluster: Number(k) });
  }
  return { ...s, auto, clusters: new Set(final).size };
}

export function namesChanged(s: NamingStats): number {
  return s.auto.filter((a) => a.changedTo !== undefined).length;
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : "n/a";
}

/** The plain-text report the owner copies after a test call. */
export function formatReport(s: NamingStats, opts?: { speakerLabel?: (n: number) => string }): string {
  const label = opts?.speakerLabel ?? ((n: number) => `Speaker ${n + 1}`);
  const lines: string[] = [];
  lines.push("Minutely naming report");
  lines.push(`Call: ${s.platform ?? "unknown platform"}`);
  lines.push(`Voices found: ${s.clusters}`);
  const screen = s.auto.filter((a) => a.source === "screen");
  const me = s.auto.filter((a) => a.source === "me");
  const changed = screen.filter((a) => a.changedTo !== undefined);
  lines.push(`Names read from the screen: ${screen.length} (${changed.length} changed by you afterwards, ${pct(screen.length - changed.length, screen.length)} kept)`);
  lines.push(`"You" label on the microphone voice: ${me.length ? "yes" : "no"}`);
  lines.push(`Screen reads: ${s.reads} (usable name ${s.usable}, rejected ${s.rejected}, no speaking tile found ${s.noTile}, errors ${s.failed})`);
  lines.push(`Tile found by: highlight ring ${s.ring}, speaker view ${s.speakerView}`);
  for (const a of s.auto) {
    const base = `${label(a.cluster)}: ${a.name} (${a.source === "me" ? "microphone" : `${a.level}, ${a.reads} read${a.reads === 1 ? "" : "s"}`})`;
    lines.push(a.changedTo !== undefined ? `${base} -> you changed it to ${a.changedTo || "(cleared)"}` : base);
  }
  lines.push("Nothing here left this device.");
  return lines.join("\n");
}

/** Safe parse of what was stored. */
export function parseStats(x: unknown): NamingStats | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<NamingStats>;
  if (o.v !== 1 || !Array.isArray(o.auto)) return null;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    v: 1,
    platform: typeof o.platform === "string" ? o.platform : null,
    startedAt: num(o.startedAt),
    clusters: num(o.clusters),
    reads: num(o.reads),
    usable: num(o.usable),
    rejected: num(o.rejected),
    noTile: num(o.noTile),
    failed: num(o.failed),
    ring: num(o.ring),
    speakerView: num(o.speakerView),
    auto: o.auto
      .filter((a): a is AutoEntry => !!a && typeof a.name === "string" && Number.isInteger(a.cluster))
      .map((a) => ({
        cluster: a.cluster,
        name: a.name,
        level: a.level === "confirmed" ? "confirmed" : "probable",
        source: a.source === "me" ? "me" : "screen",
        reads: num(a.reads),
        ...(typeof a.changedTo === "string" ? { changedTo: a.changedTo } : {}),
      })),
  };
}
