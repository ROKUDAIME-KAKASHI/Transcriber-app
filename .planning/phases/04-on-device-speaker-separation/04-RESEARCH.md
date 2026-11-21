# Phase 4: On-Device Speaker Separation - Research

**Researched:** 2026-11-21
**Domain:** On-device speaker embeddings (WeSpeaker ResNet34 via transformers.js 4.3.2 / ORT WASM), online + agglomerative clustering, Dexie local storage, speaker relabel sync, speaker naming across UI/exports/AI
**Confidence:** HIGH for APIs and integration points (read from installed source, model loaded and run in Node this session). MEDIUM for thresholds (measured on clean and synthetically degraded LibriSpeech, not real phone meetings). LOW for phone speed (extrapolated from laptop WASM).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Model and runtime
- **D-01:** Embedding model `onnx-community/wespeaker-voxceleb-resnet34-LM`, int8/quantized (~6.7 MB), loaded with transformers.js 4.3.2 (`WeSpeakerResNetModel` + `WeSpeakerFeatureExtractor`) inside the existing speech worker, on the existing `/ort/` WASM. No new runtime. One 256-d embedding per finished VAD phrase.
- **D-02:** Registered as a diarization asset in `src/lib/speech/models.ts` (not an ASR model) so the Phase 3 "Download for offline" control downloads and reports it with the engine's chain (size label includes it). Offline: if the embedding model is not cached, recording still starts and transcribes; speaker labels are simply absent (never block recording).
- **D-03:** A Node benchmark spike (`scripts/`) runs first to measure ms per phrase and clustering quality; results are recorded in the phase directory. The phone benchmark is a human UAT item.

#### Scheduling (SPK-05)
- **D-04:** Embedding jobs are a third, lowest priority class in the worker: they run only when no final or partial transcription job is waiting or running. Skipped (not queued) when the transcription backlog is high (finals queued above a threshold) or when the device is slow; skipped phrases fall back to "inherit previous speaker" and can be embedded later by the post-stop pass if time allows. Embedding must never delay a final job by more than one embedding duration.
- **D-05:** Phrases shorter than 1 s are not embedded; they inherit the previous phrase's speaker (first phrase is Speaker 1).

#### Live labelling (SPK-01)
- **D-06:** Online centroid assignment in a pure, testable module (`src/lib/speech/diarize.ts`): cosine similarity to running speaker centroids; >= theta (default 0.55, tunable constant) joins the best speaker and updates its centroid, otherwise a new speaker is created (capped, e.g. 8 live speakers; beyond cap assign nearest). Speaker numbers are 0-based in storage (matching Deepgram / `TranscriptPart.speaker`), shown 1-based.
- **D-07:** Labels appear on parts as `speaker` (existing field). TranscriptView already shows multi-speaker bubbles; a meeting where only one speaker is detected shows no labels (existing behaviour).

#### Refinement at stop (SPK-02)
- **D-08:** On stop, run agglomerative re-clustering (average-linkage, cosine distance threshold) over the stored per-phrase embeddings. For long meetings (> ~1500 phrases) cluster per-window centroids to bound O(n^2). A "number of speakers" hint is deferred. The result relabels parts; labels are stable by order of first appearance. Refined labels are written to Dexie and pushed through the Phase 2 `PATCH /api/meetings/:id/speakers` route (`parts` overrides or `relabel` map) via the `speakers` dirty flag.
- **D-09:** Embeddings are stored in the Dexie store (new table, per meeting, 256-d Float32 per phrase index), never raw audio. They are deleted with the meeting and are not synced to the server (device-local; the relabel result is what syncs).

#### Names (SPK-03)
- **D-10:** `speakerNames` (record "0".."n" -> name), already in the Dexie meeting and server schema from Phase 2, is the single source. One shared helper `speakerLabel(n, names)` returns the name or "Speaker N" and is used by TranscriptView, TXT (`transcriptToText`), docx, html/PDF exporters and the AI minutes transcript text. Rename once = update `speakerNames`, mark `meta`/`speakers` dirty, sync.
- **D-11:** Rename UI is a small sheet/popover opened by tapping a speaker chip (consistent with Phase 1 overlays + back-button handling).

#### AI minutes (SPK-04)
- **D-12:** `transcriptToText` always emits "Name:" labels when the meeting has more than one speaker; the process route uses names, and its prompt drops the "on-device recordings have no labels" sentence, saying labels come from automatic speaker separation (on-device or cloud) and may occasionally mix people up.

#### Engines and compatibility
- **D-13:** Deepgram meetings never run diarization. Website and Android online behaviour, old APKs and existing meetings (all speaker 0) keep working; diarization failure at any point is silent (labels stay as they are) and never breaks transcription.

### Claude's Discretion
Exact thresholds, window sizes, table/index layout, UI wording, test strategy (pure-logic tests for diarize.ts/labels; typecheck + build otherwise).

### Deferred Ideas (OUT OF SCOPE)
- Merge speakers / split phrase at speaker change (pyannote segmentation) - SPK-V2-01
- Speaker-count hint UI
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPK-01 | On-device recordings label each phrase with a speaker, no internet | Worker API (`AutoModel`/`AutoFeatureExtractor`, output `last_hidden_state [1,256]`), embed-after-final protocol, `diarize.ts` online assignment (theta measured), phrase-id -> part-index map in `useRecorder.appendFinal` |
| SPK-02 | Labels refined after stop and saved | Two-stage AHC (micro-clusters + average linkage, threshold measured), overlap-based label mapping that preserves names, Dexie `embeddings` table (version 2), `relabelPending` flag + speakers step in `sync.ts` calling `/speakers` with `parts` overrides |
| SPK-03 | Rename once, applies to transcript, exports, minutes | `speakerLabel` in `src/lib/transcript.ts` (node-testable), all 6 call sites listed, `setSpeakerNames` already exists in repo.ts, `MeetingData` needs `speakerNames`, server-only meetings use `/speakers` directly |
| SPK-04 | AI minutes attribute statements for on-device recordings | Process route: select `speakerNames` (legacy fallback), pass names to `transcriptToText`, fix per-chunk `multiSpeaker` bug, prompt edit; `flush()` before process already syncs speakers step |
| SPK-05 | Separation never makes live transcription fall behind on a mid-range phone | Measured cost (laptop WASM 1 thread: ~120 ms per audio second), crop rule (embed at most 6 s, 3 s on slow devices), scheduler rules (lowest priority, skip when `finals.length >= 2`, bounded queue, busy-fraction guard), no extra audio copy (reuse transferred buffer in worker) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Keep Next.js 16 App Router + Tailwind v4 + Capacitor 8. No rewrite.
- Never print `.env` / keystore secrets; keys stay server-side.
- No Vercel deploys or public tunnels by Claude.
- C: drive nearly full (9.1 GB free measured): avoid big downloads and emulators. This phase adds one 6.7 MB model.
- Research agents on Opus; implementation on Sonnet; small tasks on Haiku.
- Must keep working as a plain website (laptop browsers) and inside the Android app.
- Start file-changing work through a GSD command (`/gsd-execute-phase`).
- From STACK.md: diarization runs in the existing speech worker with existing `/ort/` WASM, no sherpa-onnx, no raw audio storage, pyannote labels never used as global IDs, the SW must not cache HF model URLs (transformers-cache owns them).
- UI-SPEC (04-UI-SPEC.md): no new colors, fonts or dependencies; `speakerLabel` must be the only producer of `Speaker N` strings; no technical words ("embedding", "diarization", "cluster") in UI copy.

## Summary

The embedding model works exactly as the context assumes, with one naming correction: the app should load it with `dtype: "q8"` (maps to `onnx/model_quantized.onnx`, 6,685,134 bytes; identical to `model_uint8.onnx`), the same dtype the ASR models use. `model_int8.onnx` (6,685,123 bytes) is a separate file; either works, but q8 keeps one dtype across the worker. Loading is `AutoFeatureExtractor.from_pretrained(repo)` + `AutoModel.from_pretrained(repo, { device: "wasm", dtype: "q8" })`, which resolves to `WeSpeakerFeatureExtractor` + `WeSpeakerResNetModel` (verified by running it in Node). Input is `input_features [1, frames, 80]` (Kaldi fbank, 10 ms hop, min 9 frames); output key is `last_hidden_state` with dims `[1, 256]`. Offline cache checks use `ModelRegistry.is_cached_files(repo, { device: "wasm", dtype: "q8", include_tokenizer: false })`, which returns `config.json`, `onnx/model_quantized.onnx`, `preprocessor_config.json`. `is_pipeline_cached_files` is not usable (it needs a pipeline task).

Speed is the real constraint. Measured this session on the laptop: single-thread WASM (the same onnxruntime-web build the app ships) costs **~120 ms per second of audio** (native ORT CPU ~63 ms/s); the fbank step is negligible (3-11 ms). A phone is plausibly 3-5x slower, so embedding a full 15 s phrase could take 5-9 s on the Xiaomi, which would block finals. The fix is to **crop**: embed only the middle 6 s of a phrase (quality is identical to the full phrase in our test) and drop to 3 s when the device is measured slow. Clustering quality on 6 LibriSpeech speakers was perfect at full/8 s crops; at 3 s crops with added noise+reverb, theta 0.55 over-split (8 speakers found for 6) while **theta 0.40-0.45** was correct, and AHC average-linkage **distance threshold 0.70** was best across all crop lengths. So the default theta should be 0.45, not 0.55 (Claude's discretion covers this).

The integration has three non-obvious traps the planner must design around: (1) `client.ts` `send()` **transfers** the phrase audio buffer to the worker, so the embedding must be requested in the same `transcribe` message and computed inside the worker from that buffer, never sent twice; (2) `appendFinal` drops phrases whose text is empty, so phrase IDs do not equal part indexes and a job-id -> part-index map is needed; (3) the existing sync `speakers` step only sends `speakerNames` to `/api/meetings/:id` and the tail sync only resends from `savedParts - 1`, so refined labels on already-uploaded parts would **never reach the server** unless the speakers step is extended to call `/api/meetings/:id/speakers` with `parts` overrides. A fourth: refinement can renumber speakers that the user already renamed during recording, so refined clusters must be mapped onto live labels by overlap, not only by first appearance.

**Primary recommendation:** Extend the worker protocol with `embed: true` on final `transcribe` messages and a lowest-priority embed queue (crop 6 s, skip when `finals.length >= 2`), keep all clustering in a pure `src/lib/speech/diarize.ts` (online assign theta 0.45, two-stage AHC threshold 0.70, overlap label mapping), store vectors in a Dexie v2 `embeddings` table, and push refined labels through `/speakers` `parts` overrides from the existing `speakers` dirty step.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Speaker embedding inference | Browser / Client (speech Web Worker) | — | Must run offline on device; shares ORT WASM with ASR; worker already owns audio buffers |
| Embed scheduling / skip policy | Browser (speech worker `pump`) | Main thread (status display) | Only the worker knows the real queue length and job durations |
| Live speaker assignment (online centroids) | Browser main thread (`useRecorder` + pure `diarize.ts`) | — | Cheap (k <= 8 dot products), needs the parts array and part index map |
| Post-stop re-clustering | Browser (speech worker or main thread, pure `diarize.ts`) | — | Pure JS over stored vectors; run in the worker to avoid UI jank on long meetings |
| Embedding storage | Browser IndexedDB (Dexie v2 `embeddings`) | — | D-09: device-local, never synced |
| Relabel + names persistence | Browser IndexedDB (meeting row, transcript row) | API (`/api/meetings/:id/speakers`) | Local-first; server receives `parts` overrides + `speakerNames` via the sync engine |
| Speaker label strings | Shared pure helper (`src/lib/transcript.ts`) | Used by client UI, client exports, server process route | One function used by both tiers |
| AI minutes attribution | API (`process` route) | — | Server reads `speakerNames` from DB and builds labelled transcript |

## Standard Stack

### Core (all already installed, nothing new)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@huggingface/transformers` | 4.3.2 (installed) | `AutoModel` / `AutoFeatureExtractor` for WeSpeaker, `ModelRegistry.is_cached_files` | Already ships `WeSpeakerResNetModel`, `WeSpeakerFeatureExtractor` (verified `dist/transformers.web.js` L14552, L27765, L28371) [VERIFIED: codebase + ran in Node] |
| `onnxruntime-web` | 1.31.0-dev.20260914 (transitive) | WASM runtime under `/ort/` | Same runtime as ASR; one session more [VERIFIED: node_modules] |
| `dexie` | 4.4.7 (installed) | `embeddings` table via `version(2)` | Phase 2 data layer [VERIFIED: package.json] |
| Model `onnx-community/wespeaker-voxceleb-resnet34-LM` | `onnx/model_quantized.onnx` (q8) 6,685,134 B | 256-d speaker embedding | Verified file tree via HF API; loaded and run in this session [VERIFIED: huggingface.co API] |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `onnxruntime-node` | 1.30.0 (transitive, `bin/napi-v*/win32/x64/onnxruntime_binding.node` present) | Node spike, `device: "cpu"` | `scripts/diarize-bench.mjs` only [VERIFIED: node_modules] |
| `ffmpeg` | 9.0.1 (winget, on PATH) | Decode LibriSpeech FLAC to 16 kHz f32 for the spike | Spike only [VERIFIED: command -v] |
| Node test runner | Node 24.19.0, `node --test "tests/*.test.ts"` (native type stripping) | Pure-logic tests | `diarize.ts`, `speakerLabel` [VERIFIED: package.json, node --version] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dtype: "q8"` (`model_quantized.onnx`) | `dtype: "int8"` (`model_int8.onnx`) | Same size; D-01 says "int8/quantized", both satisfy it. q8 matches the worker's ASR dtype and the file that was benchmarked. Use q8. |
| Sync relabel via `/speakers` `parts` overrides (D-08) | Lower Dexie `savedParts` to the first changed index and let the tail sync resend | Tail approach needs no route change but resends text, races with `shouldClearTail`, and contradicts locked D-08. Use `/speakers`. |
| AHC in worker | AHC on main thread | Main thread is simpler but a 1500-phrase run can jank; the worker is idle after stop. Either is acceptable if the two-stage bound is used. |

**Installation:** none. No new npm packages. The model downloads at runtime (6.7 MB) into `transformers-cache`.

## Package Legitimacy Audit

No new external packages are installed in this phase (all libraries are already in `package.json` / `node_modules`). slopcheck not run (nothing to check). The only new artifact is the Hugging Face model repo `onnx-community/wespeaker-voxceleb-resnet34-LM`, whose file list and sizes were verified via `https://huggingface.co/api/models/.../tree/main` and which loaded and produced embeddings in this session.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Spike Results (D-03, run during research)

Scripts used (scratchpad, ready to be copied into `scripts/diarize-bench.mjs`): `bench.mjs` (transformers.js node build, `device: "cpu"`, `intraOpNumThreads: 1`), `bench-wasm.mjs` (onnxruntime-web `ort.wasm.min.mjs` in Node, 1 thread, features from `WeSpeakerFeatureExtractor`), `cluster.mjs` (online + AHC, ARI scoring).

**Data:** 40 utterances, 6 speakers (LibriSpeech test-clean, CC BY 4.0) fetched via `https://datasets-server.huggingface.co/rows?dataset=openslr/librispeech_asr&config=clean&split=test&offset={0,400,800,1200,2000}&length=8` (audio URLs in `row.audio[0].src`, signed, expire), decoded with ffmpeg to 16 kHz mono f32. About 4.5 MB of FLAC downloaded, 18 MB as f32. A degraded copy was made with ffmpeg (`volume=0.5, aecho 40/75 ms, lowpass 5 kHz, pink noise amplitude 0.03`) to imitate a far-field phone. Total download in research: ~11 MB (model 6.7 MB + audio).

**Speed (laptop):**
| Runtime | Crop | ms / phrase (mean) | ms per audio second |
|---------|------|--------------------|---------------------|
| ORT node CPU, 1 thread, q8 | full (2-28 s) | 460 | 63 |
| ORT node CPU, 1 thread | 8 s | 339 | 62 |
| ORT node CPU, 1 thread | 3 s | 184 | 63 |
| **ORT web WASM, 1 thread** (app's runtime) | 8 s | 627 | 120 |
| **ORT web WASM, 1 thread** | 3 s | 352 | 121 |
| ORT web WASM, 1 thread | 1.5 s | 186 | 124 |

Fbank (feature extraction) is 3-11 ms per phrase. Model load from cache: ~4 s in Node first time (includes HEAD metadata), warm-up needed (first inference slower). Multi-thread WASM in Node failed to start (`fetch failed` for the worker script); not representative of the browser and not needed. [VERIFIED: measured]

**Phone estimate:** [ASSUMED] a mid-range Android phone running single-threaded WASM inside the WebView is 3-5x slower than this laptop: 350-600 ms per audio second. A 6 s crop then costs 2-3.6 s, a 3 s crop 1-1.8 s. This is why cropping and skipping are mandatory, and why the human phone benchmark (UAT) must check it.

**Clustering quality (ARI 1.00 = perfect, 6 true speakers):**
| Audio | Crop | same-speaker cos p5 / p50 | diff-speaker cos p95 / max | Best online theta | AHC distance threshold result |
|-------|------|---------------------------|-----------------------------|-------------------|-------------------------------|
| clean | full or 8 s | 0.65 / 0.80 | 0.30 / 0.38 | 0.40-0.60 all ARI 1.00 | 0.5-0.6 ARI 1.00; 0.7 ARI 0.97 |
| clean | 3 s | 0.58 / 0.72 | 0.28 / 0.39 | 0.40-0.50 ARI 1.00; 0.55 found 6.2 | 0.5-0.7 ARI 1.00 |
| clean | 1.5 s | 0.37 / 0.54 | 0.27 / 0.43 | 0.40 ARI 0.96 (7.1 found) | 0.75 ARI 1.00 |
| degraded | full or 8 s | 0.51 / 0.68 | 0.36 / 0.49 | 0.40-0.50 ARI 1.00; 0.55 found 6.5; 0.60 found 7.7 | 0.5-0.6 ARI 1.00; 0.7 ARI 0.97 |
| degraded | 3 s | 0.40 / 0.56 | 0.30 / 0.46 | **0.40 ARI 1.00**; 0.50 found 7.5; 0.55 found 8.0 | **0.70 ARI 1.00**; 0.6 found 7 |
| degraded | 1.5 s | 0.21 / 0.41 | 0.25 / 0.43 | none good (7-8 found) | 0.8 ARI 1.00, 0.7 found 10 |

Conclusions [VERIFIED: measured, MEDIUM for transfer to real meetings]:
- Crops of 6-8 s lose nothing versus the full phrase. 3 s is usable. Below ~1.5 s the embedding is unreliable, which confirms D-05 (skip < 1 s; treat 1-1.5 s as low weight).
- Default **theta = 0.45** for live assignment (0.55 over-splits noisy short crops). Expose as a constant.
- Default **AHC average-linkage cosine distance threshold = 0.70** (similarity 0.30). Expose as a constant.
- Real meetings (room echo, distance, same-gender colleagues, Indian-English accents) are harder than LibriSpeech. Treat these as starting values and re-tune from the phone UAT recording.

## Architecture Patterns

### System Architecture Diagram

```
 mic -> VoiceChunker (VAD) --onSegment(audio, phraseId, startSec)--> useRecorder
                                                                         |
          transcribeSegment(audio, { embed: seconds >= 1 && speakerReady })   (audio buffer TRANSFERRED)
                                                                         v
 +---------------------------- speech.worker ----------------------------------------------+
 |  finals[] (FIFO) ──► run(): ASR ──► post {result,id,text}                               |
 |      │                     └─ if job.embed && canEmbed(): embeds.push({id, crop(audio)})  |
 |      │                        else post {embedding,id,skipped:"backlog"|"short"|"slow"}   |
 |  partial (newest only)                                                                    |
 |  embeds[] (lowest; cap 3, overflow -> skipped) ──► fbank + WeSpeaker ──► L2 norm          |
 |                                                   post {embedding,id,vector} (transfer)   |
 |  pump(): finals > partial > embeds  (non-preemptive, one job at a time)                   |
 +-------------------------------------------------------------------------------------------+
          | result -> appendFinal() -> part index i (or none if empty text); jobId->i map
          | embedding -> diarize.assignOnline(state, vec) -> speaker k
          v
  partsRef[i].speaker = k  (skipped/short: inherit previous part's speaker)
  embeddings buffer ──(batched bulkPut)──► Dexie `embeddings` {meetingId, part:i, vec}
          |
  stop(): flush chunker -> await finals -> drain embeds (cap ~10 s) -> refine:
          load vectors -> diarize.refine(vectors, liveLabels) -> new labels (mapped to live by overlap)
          -> partsRef updated -> putParts + setRelabel(pending) + remap speakerNames
          v
  sync.ts speakers step: PATCH /api/meetings/:id/speakers { parts:[{index,speaker}...], speakerNames }
          v
  Server transcript JSON updated -> process route -> transcriptToText(parts, {names}) -> AI minutes

  Rename chip -> RenameSpeakerSheet -> setSpeakerNames (Dexie, dirty.speakers) -> sync (same step)
  Every "Speaker N" string -> speakerLabel(n, names)  (TranscriptView, TXT, docx, html/PDF, process route)
```

### Recommended Project Structure
```
src/lib/speech/
├── diarize.ts          # NEW pure: cosine, OnlineDiarizer state, refine (2-stage AHC), mapLabels, cropForEmbedding
├── models.ts           # + SPEAKER_MODEL = { repo, dtype: "q8", downloadMb: 7 }
├── readiness.ts        # + speaker model in size label; status "ready" still ASR-only
└── client.ts           # + embed flag on transcribeSegment, onEmbedding listener, speaker cache/prefetch, drain/cancel
src/workers/speech.worker.ts   # + speaker model load/warm-up, embeds queue, cache-status/prefetch for speaker
src/lib/transcript.ts   # + speakerLabel(n, names); transcriptToText(parts, { names?, multiSpeaker? })
src/lib/local/
├── db.ts               # + version(2): embeddings "[meetingId+part], meetingId"
├── repo.ts             # + putEmbeddings, getEmbeddings, setRelabel; purge deletes embeddings
├── types.ts            # + LocalEmbedding, LocalMeeting.relabelPending?: 0|1
└── sync.ts             # speakers step -> /speakers with parts overrides when relabelPending
src/components/
├── SpeakerChip.tsx, RenameSpeakerSheet.tsx   # per UI-SPEC
└── TranscriptView.tsx  # speakerNames prop, chip, status line
tests/diarize.test.ts, tests/speakerLabel.test.ts
scripts/diarize-bench.mjs    # D-03 spike (copy from research scratch)
```

### Pattern 1: Load WeSpeaker in the worker (no pipeline)
**What:** a second, lazily loaded model that never blocks ASR.
**When:** after the ASR model reports `ready` for moonshine/whisper (never for deepgram).
```typescript
// Source: verified against node_modules/@huggingface/transformers/dist/transformers.web.js
// (AutoModel -> WeSpeakerResNetModel via MODEL_MAPPING "wespeaker-resnet"; preprocessor_config.json
//  feature_extractor_type "WeSpeakerFeatureExtractor") and run in Node this session.
import { AutoModel, AutoFeatureExtractor, ModelRegistry, type ProgressInfo } from "@huggingface/transformers";
import { SPEAKER_MODEL } from "../lib/speech/models";

type Speaker = { fe: (a: Float32Array) => Promise<{ input_features: unknown }>; model: (i: unknown) => Promise<Record<string, { data: Float32Array; dims: number[] }>> };
let speaker: Promise<Speaker> | null = null;

function loadSpeaker(localOnly: boolean, onProgress?: (p: number) => void): Promise<Speaker> {
  if (speaker) return speaker;
  const opts = { ...(localOnly ? { local_files_only: true } : {}) };
  speaker = (async () => {
    const fe = await AutoFeatureExtractor.from_pretrained(SPEAKER_MODEL.repo, opts);
    const model = await AutoModel.from_pretrained(SPEAKER_MODEL.repo, {
      device: "wasm", dtype: "q8", ...opts,
      progress_callback: (i: ProgressInfo) => { if (i.status === "progress_total") onProgress?.(Math.round(i.progress)); },
    });
    const s = { fe, model } as unknown as Speaker;
    await embedWith(s, new Float32Array(16000)); // warm-up: first run allocates and compiles
    return s;
  })();
  speaker.catch(() => { speaker = null; }); // retry later; never surface to the user (D-13)
  return speaker;
}

async function embedWith(s: Speaker, audio: Float32Array): Promise<Float32Array> {
  const inputs = await s.fe(audio);                 // input_features [1, frames, 80]
  const out = await s.model(inputs);                // { last_hidden_state: [1, 256] }
  const v = Float32Array.from(out.last_hidden_state.data);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;     // store unit vectors: cosine = dot
  return v;
}

// cache status (offline readiness); NOT is_pipeline_cached_files (needs a task):
// ModelRegistry.is_cached_files(SPEAKER_MODEL.repo, { device: "wasm", dtype: "q8", include_tokenizer: false })
//   -> { allCached, files: [config.json, onnx/model_quantized.onnx, preprocessor_config.json] }
```
Note: transformers.js logs a harmless console warning `[resolve_model_type] Architecture(s) not found in MODEL_TYPE_MAPPING ... Falling back to EncoderOnly` because `config.json` is only `{"model_type":"wespeaker-resnet"}`. It works; do not "fix" it.

### Pattern 2: Embed request rides on the final transcribe message
**What:** `client.send()` transfers `audio.buffer` (`postMessage(..., [audio.buffer])`, client.ts L176-181), so the main thread no longer has the samples. Add `embed?: boolean` to the `transcribe` message; the worker keeps (a cropped copy of) that same buffer for the embed job.
```typescript
// worker, after the final's ASR succeeded (inside run() or in pump's finally)
const MIN_EMBED_SEC = 1.0;       // D-05
const MAX_EMBED_SEC = 6;         // measured: 6-8 s == full phrase quality
const SLOW_EMBED_SEC = 3;        // used once an embed took > SLOW_EMBED_MS
const BACKLOG_SKIP = 2;          // finals waiting -> skip (D-04)
const MAX_EMBED_QUEUE = 3;       // bounded memory; overflow -> oldest skipped
function cropMiddle(a: Float32Array, maxSec: number): Float32Array {
  const max = Math.floor(maxSec * 16000);
  if (a.length <= max) return a;
  const start = Math.floor((a.length - max) / 2);
  return a.slice(start, start + max); // slice copies -> the full phrase buffer can be GC'd
}
```
`pump()` becomes `finals.shift() ?? takePartial() ?? (finals.length === 0 && !partial ? embeds.shift() : undefined)`. Because the worker is single-threaded and non-preemptive, a final that arrives during an embed waits at most one embed duration, which is what D-04 allows; the crop bounds that duration.

### Pattern 3: Pure `diarize.ts` (node-testable)
- No imports except types; erasable TypeScript only (no `enum`, no parameter properties, no namespaces) because tests run with Node's native type stripping. Import it in tests as `../src/lib/speech/diarize.ts` (same as `tests/readiness.test.ts`).
- API sketch:
  - `createOnline(opts?: { theta?: number; maxSpeakers?: number }): OnlineState` with `centroids: Float32Array[]` (running sums) and `counts`.
  - `assignOnline(state, vec): number` — best cosine to normalized centroid; `>= theta` join + update sum; else new speaker if `< maxSpeakers` (8) else nearest.
  - `refine(vectors: (Float32Array | null)[], live: number[], opts?: { threshold?: number; maxItems?: number }): number[]` — returns a label for every part (nulls inherit the previous labelled part, first defaults to 0).
  - `mapToLive(refined: number[], live: number[]): number[]` — greedy max-overlap mapping of refined cluster ids onto live ids, new clusters get the next unused ids in order of first appearance.
  - `remapNames(names, mapping)` — if ids changed, move names accordingly.
- Two-stage AHC to bound cost (D-08): if embedded phrases > `maxItems` (300), first build micro-clusters by a strict online pass (theta 0.65) or by consecutive runs of the same live label, then average-linkage AHC over micro-cluster centroids weighted by count. Use a full similarity matrix with the Lance-Williams average update (`d(k, i∪j) = (n_i d(k,i) + n_j d(k,j)) / (n_i + n_j)`), O(k^2) memory, O(k^3) worst-case with k <= 300 (2.7e7 ops, well under a second on a phone). Do not run naive O(n^3) AHC on 1500+ raw phrases (3e9 ops).
- Optional cleanup: clusters with total speech < ~5 s (or 1 phrase) merge into their nearest cluster when similarity > 0.2; reduces phantom speakers from coughs/overlap.

### Pattern 4: Phrase -> part mapping in `useRecorder`
- `appendFinal` (useRecorder.ts L307-313) returns early when `cleanPhrase` returns empty, so not every phrase becomes a part. Change it to return the new part index (or -1) and record `jobIdToPart.set(id, index)`. Because `transcribeSegment` resolves before that job's embedding (embed runs after its final), the index is always known when the vector arrives; if -1, drop the vector.
- New parts get `speaker = previous part's speaker` (inherit) instead of hard-coded `0` once diarization is active; the embedding later sets the real label. Keep `speaker: 0` when diarization is off (Deepgram never reaches this code).
- Live relabel of an older part is fine in the UI (`partsRef` copy + `patch`), and Dexie gets it on the next autosave `putParts`. The server only gets it via the post-stop `/speakers` push (tail resends just the last part).

### Pattern 5: Relabel sync through `/speakers` (D-08)
- `src/app/api/meetings/[id]/speakers/route.ts` already accepts `parts: [{index, speaker}]` (max 60,000), `relabel`, `speakerNames`, with optimistic concurrency on `updatedAt` and legacy-column fallback. No route change needed.
- Today `sync.ts` L231-240 sends only `{ speakerNames }` to `/api/meetings/:id`. Change the speakers step to: if `cur.relabelPending === 1 && !native`, read parts with `repo.getParts` and `PATCH /api/meetings/:id/speakers` with `{ parts: parts.map((p, i) => ({ index: i, speaker: p.speaker })), speakerNames: cur.speakerNames ?? undefined }`; on ok clear `speakers` and `relabelPending`. Otherwise keep the current names-only PATCH.
- Order is already safe: the tail step runs before the speakers step and returns early on failure, so the server has every part index when overrides arrive; the route ignores indexes beyond its length.
- `setRelabel(uid, id)` sets `relabelPending: 1` and `dirty.speakers: true` (and recomputes `pending`). A plain `relabelPending?: 0 | 1` field on `LocalMeeting` needs no Dexie index, so no schema change for it.
- Non-local mode (no IndexedDB, `saveToServer` path): after the final `save("DONE")` succeeds, call `/speakers` directly with the same body.
- Server-only meetings opened on a device without a local row (MeetingLoader remote path): rename calls `/speakers` with `{ speakerNames }` directly.

### Pattern 6: Dexie version 2
```typescript
// Source: dexie.org/docs/Tutorial/Design ("New versions need only to specify changed tables")
this.version(1).stores({ meetings: "id, createdAt, status, origin, pending, deleted", transcripts: "id", kv: "key" });
this.version(2).stores({ embeddings: "[meetingId+part], meetingId" });
// row: { meetingId: string; part: number; vec: Float32Array; dur: number }  (~1 KB each; 6,000 rows for 10 h)
```
`purge()` must delete `db.embeddings.where("meetingId").equals(id).delete()` in the same transaction (add `db.embeddings` to the transaction scope). Batch writes (`bulkPut` every ~5 s or every 10 vectors) rather than one transaction per phrase.

### Anti-Patterns to Avoid
- **Sending the phrase audio twice** (once for ASR, once for embedding): doubles postMessage cost and memory; the first send already transferred the buffer.
- **Embedding the whole 15 s phrase on a phone:** 5-9 s of blocked worker.
- **Labels by first appearance only after a live rename:** renaming "Speaker 2" during recording, then refinement renumbering, attaches the name to the wrong person. Map refined to live by overlap and remap names.
- **Using `ModelRegistry.is_pipeline_cached_files` for the speaker model:** it requires a pipeline task; use `is_cached_files` with `include_tokenizer: false`.
- **Counting the speaker model in `statusFrom` "ready":** UI-SPEC says "Ready offline" depends on ASR only.
- **Running diarization on Deepgram meetings or on native (RecordingService) meetings:** native rows are Deepgram and owned by the service (D-18, D-13).
- **Per-chunk `multiSpeaker` in the process route:** `transcriptToText(chunk)` recomputes `multiSpeaker` per chunk (route L197), so a chunk with one speaker loses labels. Pass the meeting-level flag.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Kaldi fbank features | Own FFT/mel code | `WeSpeakerFeatureExtractor` (via `AutoFeatureExtractor`) | Matches the model's training front end (preemphasis 0.97, hamming 400/160, 80 mel, mean normalization) |
| Speaker embedding model | Any other model / sherpa-onnx | WeSpeaker ResNet34 q8 through transformers.js | Locked D-01; verified to load and run |
| Model download/caching/progress | Own fetch + Cache API code | `from_pretrained` + `progress_callback` (`progress_total`) + `ModelRegistry.is_cached_files` | Same `transformers-cache` as ASR; `progress_total` fires for `AutoModel` too (L21769-21795) |
| Relabel server write | New API route | Existing `PATCH /api/meetings/:id/speakers` | Already has concurrency retry, validation, legacy fallback |
| Back-button handling for the sheet | Own listener | `pushOverlay` / `closeTopOverlay` (`src/lib/overlays.ts`) | Phase 1 pattern |

**Key insight:** The only genuinely new logic is clustering (about 150 lines, pure) and scheduling (about 60 lines in the worker). Everything else is wiring into existing seams.

## Runtime State Inventory

Not a rename/refactor phase. Relevant existing state, for completeness:
| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing Dexie DB `transcriber-<userId>` at version 1; existing meetings all `speaker: 0` (on-device) or Deepgram 0-based | Dexie `version(2)` adds a table; no data migration. Old meetings untouched (D-13). |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | `/ort/` WASM copied by `scripts/copy-ort.mjs`; SW precache (Phase 3) | None; the speaker model is cached by transformers.js, not the SW |

## Common Pitfalls

### Pitfall 1: Audio buffer already transferred
**What goes wrong:** Calling a separate `embedSegment(audio)` after `transcribeSegment(audio)` sends a detached, zero-length buffer.
**Why:** `client.ts` `send()` passes `[audio.buffer]` as transferables.
**How to avoid:** One message with `embed: true`; the worker owns the audio.
**Warning signs:** Embeddings that are all identical, or fbank errors on empty input.

### Pitfall 2: Phrase index is not part index
**What goes wrong:** Labels land on the wrong paragraph after an empty phrase.
**Why:** `appendFinal` skips empty `cleanPhrase` results (useRecorder.ts L308-309).
**How to avoid:** jobId -> part index map; store embeddings keyed by part index.

### Pitfall 3: Refined labels never reach the server
**What goes wrong:** Phone shows refined speakers, website/minutes show live (or all-0) speakers.
**Why:** Tail sync resends from `savedParts - 1` only (`nextTailBatch`, syncCore.ts L15); speakers step sends only names (sync.ts L232).
**How to avoid:** `relabelPending` + `/speakers` `parts` overrides (Pattern 5). Test: record on phone, stop, open the meeting on the laptop.

### Pitfall 4: Theta too high for short, noisy phrases
**What goes wrong:** One person split into several speakers ("8 speakers for a 2-person meeting").
**Why:** Same-speaker cosine drops from ~0.8 (clean, long) to ~0.56 median (noisy 3 s) in our measurement.
**How to avoid:** theta 0.45, AHC 0.70, min-size cluster merge, crop no shorter than 3 s, skip < 1 s.

### Pitfall 5: Embedding starves or blocks transcription
**What goes wrong:** "Catching up" backlog grows when diarization is on; or embeddings never run during continuous speech.
**Why:** Non-preemptive single worker; partial previews keep coming.
**How to avoid:** Lowest priority + skip rules + bounded queue; partial previews already pause while finals wait (`previewTick` checks `pendingSegmentsRef.size === 0`), giving embeds idle gaps. Track `embedMs` and switch to 3 s crops when one embed exceeds ~1.5 s; stop embedding entirely (status "Catching up on transcription first...") when worker busy fraction over the last ~60 s exceeds ~0.85 or the slow-model switch (`trackSpeed`) already fired.
**Warning signs:** `backlog` > 1 for long stretches in a diarized recording that is fine without it.

### Pitfall 6: Skipped phrases cannot be "embedded later"
**What goes wrong:** Planner adds a post-stop pass that tries to embed skipped phrases.
**Why:** Raw audio is not stored (D-09); once skipped, the samples are gone. Only phrases still in the worker's embed queue at stop can be finished.
**How to avoid:** At stop, drain the embed queue with a cap (about 10 s, or N items), then cancel the rest; skipped parts inherit the nearest previous labelled part in `refine`.

### Pitfall 7: Renaming then refining moves names
**What goes wrong:** "Priya" ends up on someone else after stop.
**How to avoid:** `mapToLive` overlap mapping + `remapNames`; write `speakerNames` and parts in one step so the sync pushes both together.

### Pitfall 8: Speaker model blocks or breaks recording offline
**What goes wrong:** Offline start fails because the speaker model is missing, or `local_files_only` load throws and is surfaced.
**How to avoid:** Load the speaker model only after ASR `ready`, with `local_files_only` when offline, swallow failures, report `speakerReady: false` to the client. `startGate` stays ASR-only.

### Pitfall 9: Size label test breaks
**What goes wrong:** `tests/readiness.test.ts` asserts `labelSize(totalSizeMb([...]))` values ("about 100 MB" for moonshine base+tiny, "about 85 MB" whisper, "about 35 MB" tiny).
**How to avoid:** Add the speaker model through a new helper (e.g. `chainSizeMb(chain, { speaker: true })`) or update the asserted numbers deliberately: 67+32+7 = 106 -> "about 110 MB"; 82+7 = 89 -> "about 90 MB"; 32+7 = 39 -> "about 40 MB". The UI-SPEC example "about 90 -> 95 MB" is illustrative and does not match the real totals; use computed values.

### Pitfall 10: Prefetch path is ASR-pipeline-only
**What goes wrong:** `prefetchEngine` (readiness.ts) loops `client.prefetchModel(model)`, which posts `prefetch` and calls `pipeline("automatic-speech-recognition", ...)`.
**How to avoid:** Add a `prefetch-speaker` (or `asset: "speaker"`) worker message using `AutoFeatureExtractor` + `AutoModel.from_pretrained` then `model.dispose()`; include it as the last step of `prefetchEngine` with progress weighted by `downloadMb`. `prefetchModel` already refuses while the worker is busy; keep that.

### Pitfall 11: Minutes use stale server data
**What goes wrong:** AI minutes show "Speaker 2" instead of the new name.
**Why:** The process route reads the DB (`select: { title, durationSec, transcript }`), not `speakerNames`.
**How to avoid:** Select `speakerNames` too (wrapped with the legacy/missing-column fallback used in `meetingSelect.ts`), pass names to `transcriptToText`. `MeetingView.generate()` already calls `flush()` first (L193), which runs the speakers step, so names and relabels upload before processing.

### Pitfall 12: Node type stripping limits
**What goes wrong:** `node --test` fails on `diarize.ts` because of `enum` or a path alias import.
**How to avoid:** Erasable TS syntax only; relative imports with `.ts` extension; no `@/` imports in files that tests import (`transcript.ts` has none today; keep it that way). `tsconfig` has `allowImportingTsExtensions: true` and excludes `tests/`.

## Code Examples

### Shared label helper (D-10)
```typescript
// src/lib/transcript.ts (no imports; node-testable)
export type SpeakerNames = Record<string, string> | null | undefined;
export function speakerLabel(n: number, names?: SpeakerNames): string {
  const custom = names?.[String(n)]?.trim();
  return custom ? custom : `Speaker ${n + 1}`;
}
export function transcriptToText(
  parts: TranscriptPart[],
  opts: { names?: SpeakerNames; multiSpeaker?: boolean } = {},
): string {
  const multi = opts.multiSpeaker ?? new Set(parts.map((p) => p.speaker)).size > 1;
  return parts
    .map((p) => {
      const time = typeof p.t === "number" ? `[${formatDuration(Math.floor(p.t))}] ` : "";
      const who = multi ? `${speakerLabel(p.speaker, opts.names)}: ` : "";
      return `${time}${who}${p.text}`;
    })
    .join(multi ? "\n\n" : "\n");
}
```

### Every call site that must use `speakerLabel` / names [VERIFIED: grep]
| File | Line | Today |
|------|------|-------|
| `src/components/TranscriptView.tsx` | 95-100 | `Speaker {p.speaker + 1}` span -> SpeakerChip with `speakerLabel(p.speaker, speakerNames)`; add `speakerNames` + rename callback props |
| `src/lib/transcript.ts` | 27-36 | `Speaker ${p.speaker + 1}: ` |
| `src/lib/export/docx.ts` | 202-213 | `Speaker ${p.speaker + 1}: ` bold run; `buildTranscriptDocx` needs `names` |
| `src/lib/export/html.ts` | 122-126 | `<strong>Speaker ${p.speaker + 1}:</strong>`; escape the custom name (HTML injection from a user-entered name) |
| `src/lib/export/text.ts` | 12 | `transcriptToText(meeting.transcript)` -> pass names; `ExportMeeting` (types.ts) gains `speakerNames` |
| `src/components/MeetingView.tsx` | 67, 271, 537 | `rawText` (copy), `exportMeeting`, `<TranscriptView>`; `MeetingData` (L30-42) gains `speakerNames`; MeetingLoader must pass it from both the local row and the remote GET (`MEETING_FULL_SELECT` already includes it) |
| `src/components/Recorder.tsx` | 494 | live `<TranscriptView>`; rename while recording writes to the live meeting row |
| `src/app/api/meetings/[id]/process/route.ts` | 21-24 (prompt), 166-169 (select), 178, 189-197 | names + meeting-level `multiSpeaker` + prompt text (D-12) |

### Prompt replacement (D-12)
Replace the sentence "Cloud recordings label who is talking as "Speaker N:"; on-device recordings have no labels." with: "When several people speak, each line starts with the speaker's label ("Speaker N:" or a name the user gave). Labels come from automatic speaker separation (on the device or in the cloud) and can occasionally mix two people up." Keep the "With labels / Without labels" bullets, and tell the model to use a given name as-is.

### Synthetic clustering test (no audio needed)
```typescript
// tests/diarize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOnline, assignOnline, refine } from "../src/lib/speech/diarize.ts";
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function unit(v: Float32Array) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n); return v.map((x) => x / n); }
// k random speaker directions in 256-d; each phrase = direction + gaussian-ish noise tuned so
// same-speaker cosine ~0.55-0.7 and cross-speaker ~0.0-0.3 (matches the measured distributions)
```
Test cases: 3 speakers alternating -> online finds 3; one speaker -> 1 label (no chips); refine fixes a deliberately mislabelled early phrase; refine output starts at 0 and is ordered by first appearance; `mapToLive` keeps live ids when clusters agree; names remap on swap; nulls inherit; > maxItems inputs complete fast (assert < 2 s for 3,000 vectors); `speakerLabel` falls back on empty/whitespace names.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Segmentation-only demos (pyannote per 10 s window) | Embedding per VAD phrase + global clustering | — | Global IDs across a 10 h meeting; segmentation deferred (SPK-V2-01) |
| `wavlm-base-plus-sv` (100 MB) | WeSpeaker ResNet34 q8 (6.7 MB) | transformers.js 3.x/4.x added WeSpeaker | Phone-sized download |

**Deprecated/outdated:** nothing relevant.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phone single-thread WASM is 3-5x slower than this laptop (350-600 ms per audio second) | Spike Results, Pitfall 5 | If slower, even 3 s crops lag; skip rules then carry SPK-05. Phone UAT must measure `embedMs`. |
| A2 | Thresholds tuned on LibriSpeech (+synthetic degradation) transfer to real phone meetings | Spike Results | Over/under-splitting; mitigated by constants + refine + rename. Re-tune from UAT recording. |
| A3 | ORT in the APK WebView is single-threaded (no SAB) | Summary (from STACK.md) | If multi-threaded, embeds are faster; no design change |
| A4 | The worker can hold one extra ORT session (~7 MB weights plus activations) without memory trouble on 3-4 GB phones | Pattern 1 | OOM worker restart; mitigated by `worker.onerror` path already in client.ts |
| A5 | IndexedDB stores `Float32Array` via structured clone efficiently | Pattern 6 | Standard web platform behaviour; low risk |

## Open Questions (RESOLVED)

1. **Exact embed cost on the Xiaomi phone**
   - What we know: laptop WASM 1 thread = 120 ms per audio second.
   - Unclear: phone factor, thermal effect over an hour.
   - RESOLVED (plans 04-01, 04-02): log `embedMs` and `cropSec` in the worker's `embedding` message; add a dev-visible readout (console or `?debug`) for the UAT.
2. **Where to run refine (worker vs main thread)**
   - RESOLVED (plans 04-01, 04-07, main thread, k<=300): worker message `refine { vectors, live }` (worker idle after stop, pure function import). Main thread is acceptable if the two-stage bound keeps k <= 300.
3. **Stop latency budget**
   - RESOLVED (plan 04-07): Draining embeds plus refine adds up to ~10 s on slow phones before the "Saved" state. Recommendation: cap the drain, show "Refining speakers" (UI-SPEC), and never delay the DONE save more than the cap; if the cap is hit, refine with what is there.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tests, spike | yes | 24.19.0 | — |
| onnxruntime-node | spike (`device: "cpu"`) | yes | 1.30.0 (win32 x64 binary present) | onnxruntime-web WASM in Node (1 thread works) |
| ffmpeg | spike audio decode | yes | 9.0.1 | Windows SAPI TTS voices (David, Zira) for a synthetic 2-voice test |
| Internet (HF + datasets-server) | spike data, first model download | yes | — | Synthetic-embedding tests (no audio) |
| Disk | model + spike | 9.1 GB free | — | Keep spike data in the OS temp/scratch dir, not the repo |
| Android phone + `chrome://inspect` | SPK-05 UAT | human | — | — |

**Missing dependencies with no fallback:** none for implementation. The phone benchmark is a human UAT item (D-03).

## Validation Architecture

`workflow.nyquist_validation` is `false` in `.planning/config.json`: section skipped. Test strategy (Claude's discretion): `npm test` (`node --test "tests/*.test.ts"`) for `tests/diarize.test.ts` and `tests/speakerLabel.test.ts` (plus updated `tests/readiness.test.ts`), `npm run typecheck`, `npm run build`, and `node scripts/diarize-bench.mjs` (optional, needs network on first run).

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (existing) | NextAuth `getUserId` in routes |
| V3 Session Management | no | existing |
| V4 Access Control | yes | `/speakers` and process routes already filter `where: { id, userId }`; keep it |
| V5 Input Validation | yes | zod in `/speakers` (names <= 60 chars, keys `^\d{1,2}$`, <= 50 speakers, parts <= 60,000); client `maxLength=40` |
| V6 Cryptography | no | — |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| HTML injection via a speaker name in the PDF/HTML export | Tampering | Escape names in `html.ts` the same way phrase text is escaped |
| Prompt injection via a speaker name in AI minutes | Tampering | Names are capped at 60 chars by zod; acceptable risk, the user only affects their own minutes |
| Speaker id beyond palette / names map | DoS (UI) | `% 6` colors already; cap live speakers at 8 (`speakerNames` keys allow up to 99) |
| Biometric-like data (voice embeddings) leaving device | Information disclosure | D-09: never synced, deleted with the meeting |

## Sources

### Primary (HIGH confidence)
- `node_modules/@huggingface/transformers/dist/transformers.web.js` (4.3.2): `WeSpeakerFeatureExtractor` L14552-14640, `WeSpeakerResNetModel` L27763-27766, model mapping L28371, `DEFAULT_DTYPE_SUFFIX_MAPPING` L9893-9906, `get_files`/`is_cached_files` L30721-30738/L31194-31200, `PreTrainedModel` progress L21769-21795, `get_file_metadata` cache-first L7339-7380.
- Ran `AutoFeatureExtractor`/`AutoModel` + `ModelRegistry.is_cached_files` in Node 24 (transformers node build, onnxruntime-node 1.30.0) and onnxruntime-web WASM: shapes, file list, timings.
- `https://huggingface.co/api/models/onnx-community/wespeaker-voxceleb-resnet34-LM/tree/main?recursive=true`, `config.json`, `preprocessor_config.json`.
- Repo code: `src/workers/speech.worker.ts`, `src/lib/speech/client.ts`, `readiness.ts`, `models.ts`, `voiceChunker.ts` (MAX_SEGMENT_MS 15000), `src/hooks/useRecorder.ts` (L307-313, L407-444, L713-768), `src/lib/local/{db,repo,sync,syncCore,types}.ts`, `src/app/api/meetings/[id]/{route,speakers/route,process/route}.ts`, `src/lib/transcript.ts`, `src/lib/export/*`, `src/components/{TranscriptView,MeetingView,MeetingLoader,OfflineModelControl}.tsx`, `src/lib/overlays.ts`, `tests/readiness.test.ts`, `package.json`, `tsconfig.json`.
- https://dexie.org/docs/Tutorial/Design: versioning ("New versions need only to specify changed tables").

### Secondary (MEDIUM confidence)
- LibriSpeech test-clean via `datasets-server.huggingface.co` rows API: clustering measurements (clean and synthetically degraded).

### Tertiary (LOW confidence)
- Phone speed factor (A1): extrapolation, no device measurement.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - nothing new to install; model and API verified by execution.
- Architecture: HIGH - every seam read in code; traps found from code, not assumed.
- Thresholds: MEDIUM - measured, but on read speech rather than meetings.
- Phone performance: LOW - needs the UAT benchmark.

**Research date:** 2026-11-21
**Valid until:** 2026-12-21 (stable; re-check if transformers.js is bumped)
