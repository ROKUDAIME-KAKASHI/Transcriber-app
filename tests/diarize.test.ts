import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOnline,
  assignOnline,
  refine,
  mapToLive,
  compactLabels,
  remapNames,
  LIVE_THETA,
  AHC_THRESHOLD,
  MAX_LIVE_SPEAKERS,
} from "../src/lib/speech/diarize.ts";

const DIM = 256;

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function gauss(r: () => number) {
  let s = 0;
  for (let i = 0; i < 6; i++) s += r();
  return s - 3;
}
function unit(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}
function randomUnit(r: () => number) {
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) v[i] = gauss(r);
  return unit(v);
}
// speaker directions share a small common component (cross-speaker cosine ~0.1-0.2)
function speakers(k: number, r: () => number) {
  const common = randomUnit(r);
  return Array.from({ length: k }, () => {
    const g = randomUnit(r);
    return unit(g.map((x, i) => x + 0.35 * common[i]));
  });
}
// phrase = direction + noise: same-speaker cosine ~ 1/(1+s^2)  (s=0.8 -> ~0.6)
function phrase(dir: Float32Array, r: () => number, s = 0.8) {
  const n = randomUnit(r);
  return unit(dir.map((x, i) => x + s * n[i]));
}
function cos(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

test("constants match the measured values", () => {
  assert.equal(LIVE_THETA, 0.45);
  assert.equal(AHC_THRESHOLD, 0.7);
  assert.equal(MAX_LIVE_SPEAKERS, 8);
});

test("synthetic phrases have the intended cosine range", () => {
  const r = rng(1);
  const [a, b] = speakers(2, r);
  const same = cos(phrase(a, r), phrase(a, r));
  const cross = cos(phrase(a, r), phrase(b, r));
  assert.ok(same > 0.4 && same < 0.85, `same ${same}`);
  assert.ok(cross < 0.3, `cross ${cross}`);
});

test("online: 3 alternating speakers give exactly 3 ids", () => {
  const r = rng(2);
  const dirs = speakers(3, r);
  const st = createOnline();
  const ids: number[] = [];
  for (let i = 0; i < 45; i++) ids.push(assignOnline(st, phrase(dirs[i % 3], r)));
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids.slice(0, 3), [0, 1, 2]);
  for (let i = 3; i < ids.length; i++) assert.equal(ids[i], ids[i - 3]);
});

test("online: one speaker stays one label", () => {
  const r = rng(3);
  const [d] = speakers(1, r);
  const st = createOnline();
  const ids = Array.from({ length: 30 }, () => assignOnline(st, phrase(d, r)));
  assert.deepEqual(new Set(ids), new Set([0]));
});

test("online: cap assigns the nearest instead of opening speaker 9", () => {
  const r = rng(4);
  const st = createOnline({ maxSpeakers: 3 });
  const dirs = speakers(5, r);
  const ids = dirs.map((d) => assignOnline(st, d));
  assert.ok(Math.max(...ids) <= 2);
  assert.equal(st.sums.length, 3);
});

test("refine: fixes a mislabelled noisy early phrase", () => {
  const r = rng(5);
  const [a, b] = speakers(2, r);
  const vecs: Float32Array[] = [phrase(a, r, 1.2)]; // noisy first phrase of speaker A
  const truth = [0];
  for (let i = 1; i < 24; i++) {
    vecs.push(phrase(i % 2 ? b : a, r));
    truth.push(i % 2 ? 1 : 0);
  }
  const labels = refine(vecs);
  assert.equal(new Set(labels).size, 2);
  for (let i = 0; i < truth.length; i++) assert.equal(labels[i], truth[i], `part ${i}`);
});

test("refine: first label 0, ordered by first appearance, nulls inherit", () => {
  const r = rng(6);
  const [a, b, c] = speakers(3, r);
  const vecs: (Float32Array | null)[] = [null, null, phrase(b, r), phrase(b, r), null, phrase(c, r), phrase(a, r), phrase(c, r), phrase(a, r), phrase(b, r), phrase(c, r), phrase(a, r)];
  const labels = refine(vecs);
  assert.equal(labels.length, vecs.length);
  assert.equal(labels[0], 0);
  assert.equal(labels[1], 0, "leading nulls take the first labelled part");
  assert.equal(labels[2], 0);
  assert.equal(labels[4], labels[3], "null inherits the previous part");
  assert.equal(labels[5], 1);
  assert.equal(labels[6], 2);
  // first appearance order
  const seen: number[] = [];
  for (const l of labels) if (!seen.includes(l)) seen.push(l);
  assert.deepEqual(seen, seen.slice().sort((x, y) => x - y));
});

test("refine: all nulls -> zeros, empty -> []", () => {
  assert.deepEqual(refine([null, null, null]), [0, 0, 0]);
  assert.deepEqual(refine([]), []);
});

test("refine: 3,000 vectors finish in under 2 s and find about 6 speakers", () => {
  const r = rng(7);
  const dirs = speakers(6, r);
  const vecs: Float32Array[] = [];
  const live: number[] = [];
  const st = createOnline();
  for (let i = 0; i < 3000; i++) {
    const v = phrase(dirs[Math.floor(r() * 6)], r);
    vecs.push(v);
    live.push(assignOnline(st, v));
  }
  const t = performance.now();
  const labels = refine(vecs, { live });
  const ms = performance.now() - t;
  assert.ok(ms < 2000, `took ${ms} ms`);
  const found = new Set(labels).size;
  assert.ok(found >= 5 && found <= 7, `found ${found}`);
  assert.equal(labels.length, 3000);
});

test("mapToLive: same clusters, different numbers -> live ids", () => {
  assert.deepEqual(mapToLive([0, 0, 1, 1, 0], [1, 1, 0, 0, 1]), [1, 1, 0, 0, 1]);
});

test("mapToLive: a new refined cluster takes the smallest unused id", () => {
  assert.deepEqual(mapToLive([0, 0, 1, 1, 2], [0, 0, 1, 1, 1]), [0, 0, 1, 1, 2]);
  assert.deepEqual(mapToLive([0, 1, 2, 3], [0, 0, 0, 0]), [0, 1, 2, 3]);
});

test("compactLabels preserves numeric order", () => {
  assert.deepEqual(compactLabels([0, 2, 2, 5, 0]), [0, 1, 1, 2, 0]);
  assert.deepEqual(compactLabels([]), []);
});

test("remapNames: names follow the person, not the number", () => {
  assert.deepEqual(remapNames({ "1": "Priya" }, [0, 0, 1, 1], [1, 1, 0, 0]), { "0": "Priya" });
});

test("remapNames: merged ids keep the first name, absent ids are dropped", () => {
  // live 0 and 1 both merged into final 0
  assert.deepEqual(remapNames({ "0": "A", "1": "B" }, [0, 0, 1, 1], [0, 0, 0, 0]), { "0": "A" });
  // live 2 has no parts in the final labelling
  assert.deepEqual(remapNames({ "2": "Ghost" }, [0, 0], [0, 0]), {});
  assert.deepEqual(remapNames(null, [0], [0]), {});
});
