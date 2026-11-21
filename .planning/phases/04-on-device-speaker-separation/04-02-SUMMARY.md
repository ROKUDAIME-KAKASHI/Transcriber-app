---
phase: 04-on-device-speaker-separation
plan: 02
subsystem: speech
tags: [diarization, wespeaker, web-worker, scheduling]
requires: []
provides:
  - "SPEAKER_MODEL asset (models.ts)"
  - "src/lib/speech/embedSchedule.ts pure scheduling rules (cropMiddle, embedDecision, cropSecFor, busyFraction)"
  - "Worker embedding class (lowest priority, queue cap 3, crop 6 s / 3 s) and client API (transcribeFinal, onEmbedding, loadSpeakerModel, speakerReady, pendingEmbeds, drainEmbeddings, speakerCacheStatus, prefetchSpeakerModel)"
affects: [04-05, 04-06, 04-07]
tech-stack:
  added: []
  patterns: ["embedding rides on the same transcribe message (one audio transfer)", "speaker load failures post speaker-ready ok:false, never an id-less error"]
key-files:
  created: [src/lib/speech/embedSchedule.ts, tests/embedSchedule.test.ts]
  modified: [src/lib/speech/models.ts, src/workers/speech.worker.ts, src/lib/speech/client.ts]
key-decisions:
  - "Kept planned constants (MAX 6 s, SLOW 3 s, SLOW_EMBED_MS 1500); benchmark agrees"
requirements-completed: [SPK-01, SPK-05]
completed: 2026-11-21
---

# Phase 4 Plan 02: Worker speaker embeddings Summary

The speech worker now turns each finished phrase into a unit 256-d WeSpeaker q8 embedding as a lowest-priority third job class, cropped from the buffer it already received, exposed through a small client API.

## Commits
- c1bed20: SPEAKER_MODEL, embedSchedule.ts, 5 node tests
- 892741a: worker embedding class + client API

## What was built
- Worker loads the speaker model lazily after ASR is ready (local_files_only offline), warms up on 1 s of silence; failure posts `speaker-ready ok:false`.
- Embeds run only when no final/partial waits; skipped for short (<1 s), backlog (>=2 finals), slow device (switching, downgraded, busy fraction > 0.85), queue overflow (cap 3, oldest dropped), or error. Each embed logs `[speaker] embedMs=.. cropSec=..`.
- Client: one `transcribe` message with `embed` flag (single transfer); `outstandingEmbeds` tracking, `fail()`/`cancelPrefetch()` emit skipped "error" for all outstanding; `isWorkerBusy()` includes outstanding embeds.

## Deviations from Plan
**1. [Rule 3 - Blocking] `include_tokenizer` not in TS option type for `ModelRegistry.is_cached_files`** (exists at runtime in get_files). Fixed with a type cast in the worker.

## Verification
typecheck, `npm test` (129 pass), `npm run build` all pass. Not tested on-device: model load and embedMs on a phone (04-HUMAN-UAT item 1).

## Self-Check: PASSED
