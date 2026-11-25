// "Is it me?" for call recordings. The microphone and the call's tab are separate sources before they are
// mixed, so for each phrase we can compare how loud each one was. Pure, no imports (node tests load it).
// Erasable TypeScript only.

export type Who = "me" | "call" | "unknown";

export interface WhoThresholds {
  /** Mic RMS above this counts as the user speaking. */
  micActive: number;
  /** Tab RMS below this counts as the call being (nearly) silent. */
  tabQuiet: number;
  /** Mic must be at least this many times louder than the tab to be "me". */
  micRatio: number;
  /** Tab RMS above this counts as someone on the call speaking. */
  tabActive: number;
  /** Tab must be at least this many times louder than the mic to be "call". */
  tabRatio: number;
}

export const WHO: WhoThresholds = { micActive: 0.008, tabQuiet: 0.003, micRatio: 4, tabActive: 0.006, tabRatio: 1.5 };

/** One phrase: mean RMS of the mic and of the tab over the phrase's time. */
export function decideWho(micRms: number, tabRms: number, th: WhoThresholds = WHO): Who {
  if (!Number.isFinite(micRms) || !Number.isFinite(tabRms)) return "unknown";
  if (micRms >= th.micActive && tabRms <= th.tabQuiet && micRms >= th.micRatio * Math.max(tabRms, 1e-6)) return "me";
  if (tabRms >= th.tabActive && tabRms >= th.tabRatio * micRms) return "call";
  return "unknown";
}

export interface EnergySample {
  /** Milliseconds on any monotonic clock (performance.now()). */
  at: number;
  mic: number;
  tab: number;
}

/** Fixed-size history of loudness samples, newest last. */
export class EnergyRing {
  private buf: EnergySample[] = [];
  private readonly capacity: number;
  constructor(capacity = 480) {
    this.capacity = capacity;
  }

  push(s: EnergySample): void {
    this.buf.push(s);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }

  /** Mean mic / tab RMS of the samples with from <= at <= to, or null when there are none. */
  mean(from: number, to: number): { mic: number; tab: number; n: number } | null {
    let mic = 0;
    let tab = 0;
    let n = 0;
    for (const s of this.buf) {
      if (s.at < from || s.at > to) continue;
      mic += s.mic;
      tab += s.tab;
      n++;
    }
    return n ? { mic: mic / n, tab: tab / n, n } : null;
  }

  clear(): void {
    this.buf = [];
  }
}

/** Who spoke a phrase that ended `endedAgoMs` ago and lasted `durMs`, from the loudness history. */
export function whoForWindow(ring: EnergyRing, now: number, durMs: number, endedAgoMs = 600, th: WhoThresholds = WHO): Who {
  const to = now - Math.max(0, endedAgoMs);
  const from = to - Math.max(300, durMs);
  const m = ring.mean(from, to);
  if (!m || m.n < 3) return "unknown";
  return decideWho(m.mic, m.tab, th);
}

/** Per-cluster tally of who the phrases came from. */
export interface WhoTally {
  me: Map<number, number>;
  call: Map<number, number>;
}

export function newTally(): WhoTally {
  return { me: new Map(), call: new Map() };
}

export function tallyWho(t: WhoTally, cluster: number, who: Who): void {
  if (who === "unknown") return;
  const m = who === "me" ? t.me : t.call;
  m.set(cluster, (m.get(cluster) ?? 0) + 1);
}

export const ME_MIN_VOTES = 2;
export const ME_MIN_SHARE = 0.75;

/**
 * The cluster that is the user, or null. It needs at least ME_MIN_VOTES "me" phrases and at least ME_MIN_SHARE
 * of its decided phrases to be "me" (a voice that is often loud on the call is somebody else). With several
 * candidates the one with most "me" votes wins; the user is one person.
 */
export function meCluster(t: WhoTally): number | null {
  let best: number | null = null;
  let bestVotes = 0;
  for (const [cluster, me] of t.me) {
    const call = t.call.get(cluster) ?? 0;
    if (me < ME_MIN_VOTES || me / (me + call) < ME_MIN_SHARE) continue;
    if (me > bestVotes) {
      best = cluster;
      bestVotes = me;
    }
  }
  return best;
}

/** True when this phrase came from the call side, so the name on the screen may belong to its cluster. */
export function callSideDominant(who: Who): boolean {
  return who === "call";
}
