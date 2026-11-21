---
phase: 03-offline-app-shell-gating
plan: 06
subsystem: offline
tags: [model-readiness, prefetch, cache-storage, transformers-js, node-test]
requires: ["03-02", "03-03"]
provides:
  - "readiness.ts: chainFor, totalSizeMb, labelSize, statusFrom, startGate (pure) plus engineStatus/prefetchEngine (runtime)"
  - "worker cache-status and prefetch messages; load accepts localOnly"
  - "client cacheStatus, prefetchModel, cancelPrefetch, isWorkerBusy"
  - "OfflineModelControl and useOfflineReadiness (to be mounted by plan 07)"
affects: [03-07]
key-files:
  created: [src/lib/speech/readiness.ts, src/components/OfflineModelControl.tsx, tests/readiness.test.ts]
  modified: [src/lib/speech/models.ts, src/lib/speech/client.ts, src/workers/speech.worker.ts, src/lib/recordingFlag.ts]
decisions:
  - "labelSize rounds UP to the next 5 MB (never understates); real downloadMb 67/32/82 gives about 100 / 35 / 85 MB"
  - "Offline loads pass local_files_only only when connectivity is offline; online behaviour unchanged"
  - "Readiness chain is cached[0] = preferred model for the Start gate"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-02]
---

# Phase 3 Plan 06: Offline model download Summary

Readiness now comes from Cache Storage (`ModelRegistry.is_pipeline_cached_files` plus the ORT wasm via `caches.match`), a cancellable prefetch downloads the preferred model and fallback with progress, and loads made while offline use `local_files_only`. The `OfflineModelControl` panel implements the UI-SPEC section 4 states. 110 tests pass, typecheck clean.

## Commits
- 8b7345a: readiness helpers, downloadMb sizes, tests (9 cases)
- ac074c9: worker cache-status/prefetch, client wrappers, offline-safe load
- f1b5b87: OfflineModelControl

## Deviations from Plan
- [Rule 2] Added `isWebRecordingNow()` to `recordingFlag.ts` so `isWorkerBusy()` also reports an active web recording (T-03-22). Busy = pending phrases or a web recording; a worker with a loaded idle model can still be reset by cancel.
- Badge has no danger tone, so the error badge uses the `live` tone (danger colours).
- Size rounding is ceil-to-5 rather than nearest-5; nearest-5 could not produce the required "about 35 MB" for Tiny (32 MB).

## Notes
- Not yet mounted; plan 07 puts `OfflineModelControl` in Recorder and uses `startGate` / `useOfflineReadiness`.
- Download and cache behaviour not exercised against Hugging Face (no model downloads allowed); needs device check.

## Self-Check: PASSED
