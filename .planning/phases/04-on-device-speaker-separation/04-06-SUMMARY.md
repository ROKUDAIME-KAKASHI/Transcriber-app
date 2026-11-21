---
phase: 04-on-device-speaker-separation
plan: 06
subsystem: offline-readiness
tags: [speaker-model, offline, readiness]
requires: [04-02]
provides: [speaker model in offline size, status and prefetch]
affects: [src/lib/speech/readiness.ts, src/components/OfflineModelControl.tsx]
key-files:
  modified: [src/lib/speech/readiness.ts, tests/readiness.test.ts, src/components/OfflineModelControl.tsx]
requirements: [SPK-01]
---

# Phase 4 Plan 06: Offline speaker model Summary

Offline readiness now counts and downloads the ~7 MB speaker model (size labels 110/90/40 MB) without making it a recording requirement.

## What changed
- `totalSizeMb(chain, {speaker})` includes the speaker model by default; new pure `needsSpeakerDownload`; `EngineReadiness.speakerCached`.
- `prefetchEngine` weights progress by download size and fetches the speaker model last, skipping saved parts. `statusFrom` and `startGate` are untouched.
- `OfflineModelControl`: subtitle ends with "+ speaker model"; when ASR is ready but the speaker model is missing it shows the UI-SPEC note and a Download for offline button.

## Commits
- feat(04-06): readiness.ts and tests
- feat(04-06): OfflineModelControl

## Deviations
None. typecheck, npm test (141 pass) and build pass.

## Self-Check: PASSED
