# Phase 4: On-Device Speaker Separation - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning (decisions auto-selected from research/STACK.md + owner brief)

<domain>
## Phase Boundary

Recordings made with the free on-device engines (Moonshine, Whisper) label each phrase with a speaker (Speaker 1, 2, ...) computed entirely on the device, refine those labels after stop, let the user rename a speaker once (applies to transcript, TXT/Word/PDF exports, AI minutes), and make AI minutes attribute statements to speakers. Diarization must never make live transcription fall behind.

NOT in this phase: Deepgram meetings (already labelled by the cloud), pyannote segmentation / mid-phrase splitting and speaker merge (SPK-V2-01), redesign (Phase 5).

Requirements: SPK-01, SPK-02, SPK-03, SPK-04, SPK-05.
</domain>

<decisions>
## Implementation Decisions

### Model and runtime
- **D-01:** Embedding model `onnx-community/wespeaker-voxceleb-resnet34-LM`, int8/quantized (~6.7 MB), loaded with transformers.js 4.3.2 (`WeSpeakerResNetModel` + `WeSpeakerFeatureExtractor`) inside the existing speech worker, on the existing `/ort/` WASM. No new runtime. One 256-d embedding per finished VAD phrase.
- **D-02:** Registered as a diarization asset in `src/lib/speech/models.ts` (not an ASR model) so the Phase 3 "Download for offline" control downloads and reports it with the engine's chain (size label includes it). Offline: if the embedding model is not cached, recording still starts and transcribes; speaker labels are simply absent (never block recording).
- **D-03:** A Node benchmark spike (`scripts/`) runs first to measure ms per phrase and clustering quality; results are recorded in the phase directory. The phone benchmark is a human UAT item.

### Scheduling (SPK-05)
- **D-04:** Embedding jobs are a third, lowest priority class in the worker: they run only when no final or partial transcription job is waiting or running. Skipped (not queued) when the transcription backlog is high (finals queued above a threshold) or when the device is slow; skipped phrases fall back to "inherit previous speaker" and can be embedded later by the post-stop pass if time allows. Embedding must never delay a final job by more than one embedding duration.
- **D-05:** Phrases shorter than 1 s are not embedded; they inherit the previous phrase's speaker (first phrase is Speaker 1).

### Live labelling (SPK-01)
- **D-06:** Online centroid assignment in a pure, testable module (`src/lib/speech/diarize.ts`): cosine similarity to running speaker centroids; >= theta (default 0.55, tunable constant) joins the best speaker and updates its centroid, otherwise a new speaker is created (capped, e.g. 8 live speakers; beyond cap assign nearest). Speaker numbers are 0-based in storage (matching Deepgram / `TranscriptPart.speaker`), shown 1-based.
- **D-07:** Labels appear on parts as `speaker` (existing field). TranscriptView already shows multi-speaker bubbles; a meeting where only one speaker is detected shows no labels (existing behaviour).

### Refinement at stop (SPK-02)
- **D-08:** On stop, run agglomerative re-clustering (average-linkage, cosine distance threshold) over the stored per-phrase embeddings. For long meetings (> ~1500 phrases) cluster per-window centroids to bound O(n^2). A "number of speakers" hint is deferred. The result relabels parts; labels are stable by order of first appearance. Refined labels are written to Dexie and pushed through the Phase 2 `PATCH /api/meetings/:id/speakers` route (`parts` overrides or `relabel` map) via the `speakers` dirty flag.
- **D-09:** Embeddings are stored in the Dexie store (new table, per meeting, 256-d Float32 per phrase index), never raw audio. They are deleted with the meeting and are not synced to the server (device-local; the relabel result is what syncs).

### Names (SPK-03)
- **D-10:** `speakerNames` (record "0".."n" -> name), already in the Dexie meeting and server schema from Phase 2, is the single source. One shared helper `speakerLabel(n, names)` returns the name or "Speaker N" and is used by TranscriptView, TXT (`transcriptToText`), docx, html/PDF exporters and the AI minutes transcript text. Rename once = update `speakerNames`, mark `meta`/`speakers` dirty, sync.
- **D-11:** Rename UI is a small sheet/popover opened by tapping a speaker chip (consistent with Phase 1 overlays + back-button handling).

### AI minutes (SPK-04)
- **D-12:** `transcriptToText` always emits "Name:" labels when the meeting has more than one speaker; the process route uses names, and its prompt drops the "on-device recordings have no labels" sentence, saying labels come from automatic speaker separation (on-device or cloud) and may occasionally mix people up.

### Engines and compatibility
- **D-13:** Deepgram meetings never run diarization. Website and Android online behaviour, old APKs and existing meetings (all speaker 0) keep working; diarization failure at any point is silent (labels stay as they are) and never breaks transcription.

### Claude's Discretion
Exact thresholds, window sizes, table/index layout, UI wording, test strategy (pure-logic tests for diarize.ts/labels; typecheck + build otherwise).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/STACK.md` (Diarization section), `.planning/research/ARCHITECTURE.md`, `.planning/research/FEATURES.md` (Aurora Ink), `.planning/research/PITFALLS.md`
- `.planning/REQUIREMENTS.md` (SPK-01..05), `.planning/ROADMAP.md` (Phase 4)
- `.planning/phases/02-local-first-meetings-sync/02-CONTEXT.md` (Dexie schema, speakers PATCH route D-14), `.planning/phases/03-offline-app-shell-gating/03-CONTEXT.md` (offline download control)
- `src/workers/speech.worker.ts`, `src/lib/speech/client.ts`, `src/lib/speech/models.ts`, `src/lib/speech/readiness.ts`, `src/lib/speech/voiceChunker.ts`
- `src/hooks/useRecorder.ts` (on-device phrase flow, save/stop), `src/lib/local/*` (db, repo, sync), `src/app/api/meetings/[id]/speakers/route.ts`, `src/app/api/meetings/[id]/process/route.ts`
- `src/components/TranscriptView.tsx`, `src/lib/transcript.ts`, `src/lib/export/*`, `src/components/OfflineModelControl.tsx`
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Speech worker already has a final/partial scheduler (`pump`) to extend with an embedding class.
- `TranscriptPart.speaker` exists; TranscriptView, exports and the speakers PATCH route already handle multi-speaker meetings (named "Speaker N").
- Phase 3 readiness/prefetch (`chainFor`, `prefetchModel`, `cacheStatus`) for offline download.

### Integration Points
- `useRecorder` on-device branch appends parts at ~line 310 with `speaker: 0`; the phrase audio is available there for embedding.
- Dexie schema version bump for an embeddings table.
</code_context>

<specifics>
## Specific Ideas

Rename-once-applies-everywhere; labels never block or slow transcription; skip Deepgram meetings.
</specifics>

<deferred>
## Deferred Ideas

- Merge speakers / split phrase at speaker change (pyannote segmentation) - SPK-V2-01
- Speaker-count hint UI
</deferred>
