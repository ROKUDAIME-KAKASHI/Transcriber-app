// Pure speaker clustering for on-device speaker separation (Phase 4).
//
// No imports, erasable TypeScript only (no enum / namespace / parameter properties): tests and the
// benchmark script run this file with Node's native type stripping.
//
// All vectors are unit-length Float32Array(256) (the speech worker L2-normalises), so cosine = dot product.
// Live labels come from online centroid assignment (assignOnline); at stop, refine() re-clusters every
// embedded phrase with two-stage average-linkage AHC and mapToLive() maps the result back onto the live
// numbering so names the user typed during recording stay on the right person.

export type SpeakerStatus = "identifying" | "catching-up" | "refining" | null;

// Measured in 04-BENCHMARK.md: theta 0.55 over-splits noisy 3 s crops (7.8 speakers found for 6), 0.45
// keeps them together. CONTEXT D-06 proposed 0.55 as a default; tunable, re-check from the phone UAT.
export const LIVE_THETA = 0.45;
// Average-linkage cosine DISTANCE threshold (merge clusters while their distance < 0.70).
export const AHC_THRESHOLD = 0.7;
export const MAX_LIVE_SPEAKERS = 8;
// Above this many embedded phrases, refine() first builds micro-clusters so AHC stays O(k^3) with k <= 300.
export const REFINE_MAX_ITEMS = 300;

export type OnlineState = { theta: number; maxSpeakers: number; sums: Float32Array[]; counts: number[] };

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a)) || 1;
}

function unit(a: Float32Array): Float32Array {
  const n = norm(a);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / n;
  return out;
}

export function createOnline(opts?: { theta?: number; maxSpeakers?: number }): OnlineState {
  return { theta: opts?.theta ?? LIVE_THETA, maxSpeakers: opts?.maxSpeakers ?? MAX_LIVE_SPEAKERS, sums: [], counts: [] };
}

/** Assigns the vector to the closest running centroid (cosine >= theta) or opens a new speaker. Returns a 0-based id. */
export function assignOnline(state: OnlineState, vec: Float32Array): number {
  let best = -1;
  let bestSim = -Infinity;
  for (let i = 0; i < state.sums.length; i++) {
    const s = dot(state.sums[i], vec) / norm(state.sums[i]);
    if (s > bestSim) {
      bestSim = s;
      best = i;
    }
  }
  const join = best >= 0 && (bestSim >= state.theta || state.sums.length >= state.maxSpeakers);
  if (join) {
    const sum = state.sums[best];
    for (let i = 0; i < sum.length; i++) sum[i] += vec[i];
    state.counts[best] += 1;
    return best;
  }
  state.sums.push(Float32Array.from(vec));
  state.counts.push(1);
  return state.sums.length - 1;
}

type Item = { vec: Float32Array; weight: number; members: number[] };

/** Renumbers labels 0,1,2... by first appearance. */
function byFirstAppearance(labels: number[]): number[] {
  const map = new Map<number, number>();
  return labels.map((l) => {
    let v = map.get(l);
    if (v === undefined) {
      v = map.size;
      map.set(l, v);
    }
    return v;
  });
}

/**
 * Stop-time re-clustering. vectors[i] is the embedding of transcript part i or null when that part has no
 * vector (skipped / short). Returns one label for every part, ordered by first appearance. Parts without a
 * vector inherit the previous labelled part; leading ones take the first labelled part's label.
 * opts.live (optional) only guides micro-clustering when there are more than maxItems vectors.
 */
export function refine(
  vectors: (Float32Array | null)[],
  opts?: { threshold?: number; maxItems?: number; live?: number[] },
): number[] {
  const threshold = opts?.threshold ?? AHC_THRESHOLD;
  const maxItems = Math.max(2, opts?.maxItems ?? REFINE_MAX_ITEMS);
  const live = opts?.live;
  const n = vectors.length;
  if (n === 0) return [];

  const embedded: number[] = [];
  for (let i = 0; i < n; i++) if (vectors[i]) embedded.push(i);
  if (embedded.length === 0) return new Array(n).fill(0);

  // 1. Items: every vector, or micro-clusters of consecutive same-live-label vectors when there are too many.
  const items: Item[] = [];
  if (embedded.length > maxItems) {
    const groups = new Map<number, number[]>();
    for (const i of embedded) {
      const g = live?.[i] ?? 0;
      const list = groups.get(g);
      if (list) list.push(i);
      else groups.set(g, [i]);
    }
    const chunk = Math.ceil(embedded.length / maxItems);
    for (const list of groups.values()) {
      for (let s = 0; s < list.length; s += chunk) {
        const members = list.slice(s, s + chunk);
        const sum = new Float32Array((vectors[members[0]] as Float32Array).length);
        for (const m of members) {
          const v = vectors[m] as Float32Array;
          for (let d = 0; d < sum.length; d++) sum[d] += v[d];
        }
        items.push({ vec: unit(sum), weight: members.length, members });
      }
    }
  } else {
    for (const i of embedded) items.push({ vec: vectors[i] as Float32Array, weight: 1, members: [i] });
  }

  // 2. Average-linkage AHC with Lance-Williams updates on a full cosine-distance matrix.
  const k = items.length;
  const D = new Float32Array(k * k);
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const d = 1 - dot(items[a].vec, items[b].vec);
      D[a * k + b] = d;
      D[b * k + a] = d;
    }
  }
  const active = new Uint8Array(k).fill(1);
  const size = items.map((it) => it.weight);
  const owner = Array.from({ length: k }, (_, i) => i); // item -> cluster representative
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (let a = 0; a < k; a++) {
      if (!active[a]) continue;
      for (let b = a + 1; b < k; b++) {
        if (!active[b]) continue;
        const d = D[a * k + b];
        if (d < bd) {
          bd = d;
          bi = a;
          bj = b;
        }
      }
    }
    if (bi < 0 || bd >= threshold) break;
    const ni = size[bi];
    const nj = size[bj];
    for (let c = 0; c < k; c++) {
      if (!active[c] || c === bi || c === bj) continue;
      const d = (ni * D[bi * k + c] + nj * D[bj * k + c]) / (ni + nj);
      D[bi * k + c] = d;
      D[c * k + bi] = d;
    }
    size[bi] = ni + nj;
    active[bj] = 0;
    for (let t = 0; t < k; t++) if (owner[t] === bj) owner[t] = bi;
  }

  // 3. Small-cluster cleanup: a one-phrase cluster (cough, overlap) joins its nearest cluster if similar enough.
  if (embedded.length >= 6) {
    const reps = () => {
      const out: number[] = [];
      for (let c = 0; c < k; c++) if (active[c]) out.push(c);
      return out;
    };
    const centroid = (rep: number) => {
      const sum = new Float32Array(items[0].vec.length);
      for (let t = 0; t < k; t++) {
        if (owner[t] !== rep) continue;
        for (let d = 0; d < sum.length; d++) sum[d] += items[t].vec[d] * items[t].weight;
      }
      return unit(sum);
    };
    for (const rep of reps()) {
      if (!active[rep] || size[rep] !== 1) continue;
      const others = reps().filter((c) => c !== rep);
      if (others.length === 0) break;
      const mine = centroid(rep);
      let best = -1;
      let bestSim = -Infinity;
      for (const o of others) {
        const s = dot(mine, centroid(o));
        if (s > bestSim) {
          bestSim = s;
          best = o;
        }
      }
      if (best >= 0 && bestSim > 0.2) {
        size[best] += size[rep];
        active[rep] = 0;
        for (let t = 0; t < k; t++) if (owner[t] === rep) owner[t] = best;
      }
    }
  }

  // 4. Expand to parts, inherit for parts without a vector, renumber by first appearance.
  const partLabel: (number | null)[] = new Array(n).fill(null);
  items.forEach((it, idx) => {
    for (const m of it.members) partLabel[m] = owner[idx];
  });
  const firstLabelled = partLabel.find((l) => l !== null) as number;
  const filled: number[] = [];
  let prev = firstLabelled;
  for (let i = 0; i < n; i++) {
    const l = partLabel[i];
    if (l !== null) prev = l;
    filled.push(prev);
  }
  return byFirstAppearance(filled);
}

/**
 * Maps refined cluster ids onto the live id space by greedy maximum overlap (each live id used once).
 * Unmatched refined clusters get the smallest unused ids, in order of first appearance.
 */
export function mapToLive(refined: number[], live: number[]): number[] {
  const n = Math.min(refined.length, live.length);
  const overlap = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = refined[i] + "|" + live[i];
    overlap.set(key, (overlap.get(key) ?? 0) + 1);
  }
  const pairs = Array.from(overlap, ([key, count]) => {
    const [r, l] = key.split("|").map(Number);
    return { r, l, count };
  }).sort((a, b) => b.count - a.count || a.r - b.r || a.l - b.l);

  const mapping = new Map<number, number>();
  const usedLive = new Set<number>();
  for (const p of pairs) {
    if (mapping.has(p.r) || usedLive.has(p.l)) continue;
    mapping.set(p.r, p.l);
    usedLive.add(p.l);
  }
  const used = new Set(mapping.values());
  let next = 0;
  for (const r of refined) {
    if (mapping.has(r)) continue;
    while (used.has(next)) next++;
    mapping.set(r, next);
    used.add(next);
  }
  return refined.map((r) => mapping.get(r) as number);
}

/** Renumbers labels to 0..m-1 preserving numeric order: [0,2,2,5,0] -> [0,1,1,2,0]. */
export function compactLabels(labels: number[]): number[] {
  const sorted = Array.from(new Set(labels)).sort((a, b) => a - b);
  const rank = new Map<number, number>();
  sorted.forEach((l, i) => rank.set(l, i));
  return labels.map((l) => rank.get(l) as number);
}

/**
 * Moves speaker names with the person, not the number (trap 4). A name goes to the final id that most of its
 * live parts now carry, if that id has no name yet. Names whose id has no parts in final are dropped.
 */
export function remapNames(
  names: Record<string, string> | null | undefined,
  live: number[],
  final: number[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!names) return out;
  const n = Math.min(live.length, final.length);
  const ids = Object.keys(names)
    .filter((k) => String(names[k] ?? "").trim() !== "" && Number.isInteger(Number(k)))
    .sort((a, b) => Number(a) - Number(b));
  for (const key of ids) {
    const l = Number(key);
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) if (live[i] === l) counts.set(final[i], (counts.get(final[i]) ?? 0) + 1);
    let target = -1;
    let top = 0;
    for (const [f, c] of counts) {
      if (c > top || (c === top && f < target)) {
        top = c;
        target = f;
      }
    }
    if (target < 0) continue;
    if (out[String(target)] === undefined) out[String(target)] = names[key];
  }
  return out;
}
