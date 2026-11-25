// Voting: turns many noisy name reads into at most one name per voice. Pure, erasable TypeScript only.
//
// Rules (Phase 23):
//  - a read counts only with enough OCR confidence (a lower bar when the name matches somebody expected);
//  - a name is applied when it wins at least 2 reads, or 1 read that matches an expected attendee;
//  - it shows as "probably {name}" until 3 reads agree, then it is confirmed;
//  - a name the person set themselves is never replaced, and a voice they renamed is never touched again;
//  - one name goes to one voice (unless the user merges voices themselves, which only they can do).

import { normKey } from "./nameClean.ts";

export const MIN_CONF = 55;
export const ROSTER_MIN_CONF = 40;
export const APPLY_READS = 2;
export const CONFIRM_READS = 3;

export type Level = "probable" | "confirmed";

export interface Read {
  cluster: number;
  /** Cleaned name (the roster spelling when it matched). */
  name: string;
  /** OCR confidence 0..100. */
  conf: number;
  /** The name matched somebody we expected in the meeting. */
  roster: boolean;
}

interface Tally {
  display: string;
  n: number;
  rosterN: number;
  confSum: number;
}

export interface VoteState {
  /** cluster -> normalised name -> tally */
  byCluster: Map<number, Map<string, Tally>>;
}

export function newVotes(): VoteState {
  return { byCluster: new Map() };
}

/** Whether a read has enough confidence to be counted. */
export function readCounts(r: Pick<Read, "conf" | "roster">): boolean {
  return r.conf >= (r.roster ? ROSTER_MIN_CONF : MIN_CONF);
}

/** Adds a read. Returns false (and changes nothing) when it is too uncertain to count. */
export function addRead(v: VoteState, r: Read): boolean {
  if (!readCounts(r)) return false;
  const key = normKey(r.name);
  if (!key) return false;
  let m = v.byCluster.get(r.cluster);
  if (!m) {
    m = new Map();
    v.byCluster.set(r.cluster, m);
  }
  const t = m.get(key) ?? { display: r.name, n: 0, rosterN: 0, confSum: 0 };
  t.n += 1;
  t.rosterN += r.roster ? 1 : 0;
  t.confSum += r.conf;
  if (r.roster) t.display = r.name; // the roster's spelling wins
  m.set(key, t);
  return true;
}

export interface Leader {
  name: string;
  key: string;
  reads: number;
  rosterReads: number;
  /** Reads of the second most read name (0 when there is none). */
  runnerUp: number;
}

/** The most read name for a voice, or null. */
export function leader(v: VoteState, cluster: number): Leader | null {
  const m = v.byCluster.get(cluster);
  if (!m || m.size === 0) return null;
  const all = [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].confSum - a[1].confSum);
  const [key, t] = all[0];
  return { name: t.display, key, reads: t.n, rosterReads: t.rosterN, runnerUp: all[1] ? all[1][1].n : 0 };
}

/** What the reads say, ignoring everything else: null = not enough yet. */
export function levelFor(l: Leader | null): Level | null {
  if (!l || l.reads <= l.runnerUp) return null; // a tie decides nothing
  if (l.reads >= CONFIRM_READS) return "confirmed";
  if (l.reads >= APPLY_READS) return "probable";
  if (l.reads >= 1 && l.rosterReads >= 1 && l.runnerUp === 0) return "probable";
  return null;
}

export interface AutoName {
  name: string;
  level: Level;
  /** "screen": read from the call screen. "me": the voice on the microphone. */
  source: "screen" | "me";
}

export interface NamingContext {
  /** The meeting's current speaker names (user-set and automatic), index as string -> name. */
  names: Record<string, string> | null | undefined;
  /** What this feature has put into `names` itself. */
  auto: ReadonlyMap<number, AutoName>;
  /** Voices the user renamed (or cleared) while recording: never touched again. */
  locked: ReadonlySet<number>;
}

/** The voice's name was typed by the user (anything in `names` that is not exactly what we wrote). */
export function isUserNamed(ctx: NamingContext, cluster: number): boolean {
  if (ctx.locked.has(cluster)) return true;
  const cur = ctx.names?.[String(cluster)]?.trim();
  if (!cur) return false;
  const mine = ctx.auto.get(cluster);
  return !mine || mine.name !== cur;
}

/** A different voice already carries this name. */
export function nameTakenElsewhere(ctx: NamingContext, cluster: number, name: string): boolean {
  const key = normKey(name);
  for (const [k, v] of Object.entries(ctx.names ?? {})) {
    if (Number(k) === cluster) continue;
    if (typeof v === "string" && normKey(v) === key) return true;
  }
  return false;
}

export type Plan = { kind: "none" } | { kind: "set"; name: string; level: Level };

/** What to do for one voice now: put a name into the speaker names, or leave things alone. */
export function planName(v: VoteState, cluster: number, ctx: NamingContext): Plan {
  if (isUserNamed(ctx, cluster)) return { kind: "none" };
  const l = leader(v, cluster);
  const level = levelFor(l);
  if (!l || !level) return { kind: "none" };
  if (nameTakenElsewhere(ctx, cluster, l.name)) return { kind: "none" };
  const cur = ctx.auto.get(cluster);
  if (cur) {
    if (cur.source === "me") return { kind: "none" };
    if (normKey(cur.name) === l.key) return cur.level === level ? { kind: "none" } : { kind: "set", name: cur.name, level };
    if (cur.level === "confirmed") return { kind: "none" }; // a confirmed name is not replaced by a new leader
  }
  return { kind: "set", name: l.name, level };
}

/** Plan for the "that voice is me" label (only when nobody has named the voice and the label is free). */
export function planMe(cluster: number, label: string, ctx: NamingContext): Plan {
  if (isUserNamed(ctx, cluster)) return { kind: "none" };
  const cur = ctx.auto.get(cluster);
  if (cur && cur.source === "me" && cur.name === label) return { kind: "none" };
  if (nameTakenElsewhere(ctx, cluster, label)) return { kind: "none" };
  return { kind: "set", name: label, level: "confirmed" };
}
