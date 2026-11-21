// D-03 spike: speaker-embedding speed + clustering quality benchmark.
//
// Measures WeSpeaker ResNet34 (onnx-community/wespeaker-voxceleb-resnet34-LM, q8) ms per phrase on this
// machine (Node CPU 1 thread, optionally onnxruntime-web WASM 1 thread) for several crop lengths, and
// scores online + average-linkage clustering (ARI vs true speaker) on real LibriSpeech test-clean audio
// (CC BY 4.0, public).
//
// usage: node scripts/diarize-bench.mjs [--cache <dir>] [--wasm] [--degraded] [--app] [--n 40]
//   --cache <dir>  cache folder (default: <os tmp>/transcriber-diarize-bench; env DIARIZE_BENCH_CACHE overrides)
//   --wasm         also time onnxruntime-web WASM, 1 thread (the runtime the app ships)
//   --degraded     use a far-field phone imitation of the audio (volume 0.5, echo, lowpass 5 kHz, pink noise)
//   --app          score the production clustering in src/lib/speech/diarize.ts instead of the inline reference
//   --n <count>    number of utterances to use (default 40)
//
// Downloads about 12 MB (model 6.7 MB + ~5 MB LibriSpeech FLAC) and never more than 50 MB.
// Nothing is written inside the repo by default. Needs ffmpeg on PATH.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const CACHE = path.resolve(opt("--cache", process.env.DIARIZE_BENCH_CACHE || path.join(os.tmpdir(), "transcriber-diarize-bench")));
const DEGRADED = flag("--degraded");
const N = Number(opt("--n", 40));
const MAX_BYTES = 50 * 1024 * 1024;
const REPO = "onnx-community/wespeaker-voxceleb-resnet34-LM";
const CROPS = [Infinity, 8, 6, 3, 1.5];
const SR = 16000;
let downloaded = 0;

const dirs = { flac: path.join(CACHE, "flac"), audio: path.join(CACHE, DEGRADED ? "audio-degraded" : "audio"), models: path.join(CACHE, "models") };
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
console.log(`cache: ${CACHE}${DEGRADED ? " (degraded audio)" : ""}`);

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${url.split("?")[0]}`);
  const buf = Buffer.from(await res.arrayBuffer());
  downloaded += buf.length;
  if (downloaded > MAX_BYTES) throw new Error("aborting: download would exceed the 50 MB cap");
  writeFileSync(dest, buf);
}

function ffmpeg(argv) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...argv], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed (is it installed and on PATH?)");
}

// ---- data -------------------------------------------------------------------------------------
async function prepareAudio() {
  const have = readdirSync(dirs.flac).filter((f) => f.endsWith(".flac")).sort();
  if (have.length < N) {
    for (const offset of [0, 400, 800, 1200, 2000]) {
      const url = `https://datasets-server.huggingface.co/rows?dataset=openslr/librispeech_asr&config=clean&split=test&offset=${offset}&length=8`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`datasets-server ${res.status}`);
      const json = await res.json();
      let i = 0;
      for (const { row } of json.rows) {
        const name = `${row.speaker_id}_${offset}_${i++}.flac`;
        const dest = path.join(dirs.flac, name);
        if (existsSync(dest)) continue;
        await download(row.audio[0].src, dest);
      }
    }
  }
  const files = readdirSync(dirs.flac).filter((f) => f.endsWith(".flac")).sort().slice(0, N);
  const items = [];
  for (const f of files) {
    const out = path.join(dirs.audio, f.replace(/\.flac$/, ".f32"));
    if (!existsSync(out)) {
      const src = path.join(dirs.flac, f);
      if (DEGRADED) {
        ffmpeg(["-i", src, "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.03:sample_rate=${SR}`,
          "-filter_complex", "[0:a]aresample=16000,volume=0.5,aecho=0.8:0.88:40|75:0.4|0.3,lowpass=f=5000[a];[a][1:a]amix=inputs=2:duration=first:normalize=0",
          "-ac", "1", "-ar", String(SR), "-f", "f32le", out]);
      } else {
        ffmpeg(["-i", src, "-ac", "1", "-ar", String(SR), "-f", "f32le", out]);
      }
    }
    const buf = readFileSync(out);
    items.push({ file: f, speaker: f.split("_")[0], audio: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) });
  }
  return items;
}

const cropMiddle = (audio, sec) => {
  const n = Math.floor(sec * SR);
  if (!isFinite(sec) || audio.length <= n) return audio;
  const start = Math.floor((audio.length - n) / 2);
  return audio.slice(start, start + n);
};
const l2 = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const cropName = (c) => (isFinite(c) ? `${c} s` : "full");

// ---- transformers.js (Node CPU) ---------------------------------------------------------------
const T = await import(new URL("../node_modules/@huggingface/transformers/dist/transformers.node.mjs", import.meta.url).href);
T.env.cacheDir = dirs.models;
const items = await prepareAudio();
console.log(`${items.length} utterances, ${new Set(items.map((i) => i.speaker)).size} speakers, downloaded ${(downloaded / 1048576).toFixed(1)} MB this run`);

const fe = await T.AutoFeatureExtractor.from_pretrained(REPO);
const model = await T.AutoModel.from_pretrained(REPO, { dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
async function embedNode(a) {
  const out = await model(await fe(a));
  return l2(Float32Array.from(out[Object.keys(out)[0]].data));
}
await embedNode(new Float32Array(SR)); // warm-up

const speed = []; // { runtime, crop, msPhrase, msPerSec }
const embByCrop = new Map(); // crop -> Float32Array[]
for (const crop of CROPS) {
  let ms = 0, sec = 0;
  const embs = [];
  for (const it of items) {
    const a = cropMiddle(it.audio, crop);
    const t = performance.now();
    embs.push(await embedNode(a));
    ms += performance.now() - t;
    sec += a.length / SR;
  }
  embByCrop.set(crop, embs);
  speed.push({ runtime: "Node CPU, 1 thread, q8", crop: cropName(crop), msPhrase: ms / items.length, msPerSec: ms / sec });
}

// ---- onnxruntime-web WASM, 1 thread -----------------------------------------------------------
if (flag("--wasm")) {
  const NM = new URL("../node_modules/", import.meta.url).href;
  const ort = await import(NM + "onnxruntime-web/dist/ort.wasm.min.mjs").catch(() => import(NM + "onnxruntime-web/dist/ort.min.mjs"));
  ort.env.wasm.numThreads = 1;
  const modelPath = path.join(dirs.models, REPO, "onnx", "model_quantized.onnx");
  const session = await ort.InferenceSession.create(readFileSync(modelPath), { executionProviders: ["wasm"] });
  const run = async (a) => {
    const { input_features } = await fe(a);
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input_features.data, input_features.dims) });
    return out[session.outputNames[0]];
  };
  await run(new Float32Array(SR));
  for (const crop of CROPS) {
    let ms = 0, sec = 0;
    const subset = items.slice(0, 16);
    for (const it of subset) {
      const a = cropMiddle(it.audio, crop);
      const t = performance.now();
      await run(a);
      ms += performance.now() - t;
      sec += a.length / SR;
    }
    speed.push({ runtime: "onnxruntime-web WASM, 1 thread (app runtime)", crop: cropName(crop), msPhrase: ms / subset.length, msPerSec: ms / sec });
  }
}

// ---- clustering -------------------------------------------------------------------------------
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function onlineRef(seq, theta, cap = 8) {
  const sums = [], labels = [];
  for (const e of seq) {
    let best = -1, bs = -2;
    sums.forEach((s, i) => { const v = dot(l2(s), e); if (v > bs) { bs = v; best = i; } });
    if (best >= 0 && (bs >= theta || sums.length >= cap)) { for (let k = 0; k < e.length; k++) sums[best][k] += e[k]; labels.push(best); }
    else { sums.push(Float32Array.from(e)); labels.push(sums.length - 1); }
  }
  return labels;
}
function ahcRef(seq, thr) {
  let cl = seq.map((_, i) => ({ m: [i] }));
  const sim = seq.map((a) => seq.map((b) => dot(a, b)));
  const link = (A, B) => { let s = 0; for (const i of A.m) for (const j of B.m) s += sim[i][j]; return 1 - s / (A.m.length * B.m.length); };
  for (;;) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = link(cl[i], cl[j]); if (d < bd) { bd = d; bi = i; bj = j; } }
    if (bi < 0 || bd >= thr) break;
    cl[bi] = { m: [...cl[bi].m, ...cl[bj].m] }; cl.splice(bj, 1);
  }
  const labels = new Array(seq.length);
  cl.forEach((c, k) => c.m.forEach((i) => (labels[i] = k)));
  return labels;
}
function ari(a, b) {
  const n = a.length, key = (x, y) => x + "|" + y, nij = new Map(), ai = new Map(), bj = new Map();
  for (let i = 0; i < n; i++) { nij.set(key(a[i], b[i]), (nij.get(key(a[i], b[i])) || 0) + 1); ai.set(a[i], (ai.get(a[i]) || 0) + 1); bj.set(b[i], (bj.get(b[i]) || 0) + 1); }
  const c2 = (x) => (x * (x - 1)) / 2; let s = 0, sa = 0, sb = 0;
  for (const v of nij.values()) s += c2(v); for (const v of ai.values()) sa += c2(v); for (const v of bj.values()) sb += c2(v);
  const exp = (sa * sb) / c2(n), max = (sa + sb) / 2;
  return max === exp ? 1 : (s - exp) / (max - exp);
}
const trueSpeakers = new Set(items.map((i) => i.speaker)).size;
const S = items.map((i) => i.speaker);
const SEEDS = 10;
const clusterRows = []; // { crop, method, param, ari, found }

function onlineScore(crop, label, fn) {
  const E = embByCrop.get(crop);
  let a = 0, k = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed);
    const idx = E.map((_, i) => i).sort(() => r() - 0.5); // shuffled "meeting" order
    const lab = fn(idx.map((i) => E[i]));
    a += ari(lab, idx.map((i) => S[i])); k += new Set(lab).size;
  }
  clusterRows.push({ crop: cropName(crop), method: label, ari: a / SEEDS, found: k / SEEDS });
}

let app = null;
if (flag("--app")) {
  try { app = await import(new URL("../src/lib/speech/diarize.ts", import.meta.url).href); }
  catch { console.log("diarize.ts not built yet"); }
}

for (const crop of CROPS) {
  const E = embByCrop.get(crop);
  if (!app) {
    for (const theta of [0.4, 0.45, 0.5, 0.55]) onlineScore(crop, `online theta ${theta}`, (seq) => onlineRef(seq, theta));
    for (const thr of [0.5, 0.6, 0.7, 0.8]) {
      const lab = ahcRef(E, thr);
      clusterRows.push({ crop: cropName(crop), method: `AHC dist ${thr}`, ari: ari(lab, S), found: new Set(lab).size });
    }
  } else {
    onlineScore(crop, `app assignOnline theta ${app.LIVE_THETA}`, (seq) => { const st = app.createOnline(); return seq.map((v) => app.assignOnline(st, v)); });
    // refine in time order (as in a meeting): shuffled orders, refine at AHC_THRESHOLD
    onlineScore(crop, `app refine ${app.AHC_THRESHOLD}`, (seq) => app.refine(seq));
  }
}

// ---- report -----------------------------------------------------------------------------------
console.log(`\nNode ${process.version}, ${os.cpus()[0]?.model ?? "cpu"}, ${trueSpeakers} true speakers, ${items.length} utterances, ${DEGRADED ? "degraded" : "clean"} audio\n`);
console.log("| Runtime | Crop | ms / phrase | ms per audio second |");
console.log("|---------|------|-------------|---------------------|");
for (const r of speed) console.log(`| ${r.runtime} | ${r.crop} | ${Math.round(r.msPhrase)} | ${Math.round(r.msPerSec)} |`);
console.log(`\n| Audio | Crop | Method | ARI | Speakers found (true ${trueSpeakers}) |`);
console.log("|-------|------|--------|-----|-----------------------|");
for (const r of clusterRows) console.log(`| ${DEGRADED ? "degraded" : "clean"} | ${r.crop} | ${r.method} | ${r.ari.toFixed(2)} | ${r.found.toFixed(1)} |`);
