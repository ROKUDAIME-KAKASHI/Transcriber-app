---
phase: 03-offline-app-shell-gating
plan: 03
subsystem: offline
tags: [service-worker, update-flow, chunk-recovery, apk-error-page]
requires: []
provides:
  - "updateCore: isChunkLoadError, shouldReloadForChunkError, canApplyUpdate"
  - "register.ts: registerServiceWorker, watchForUpdate, applyUpdate, warmLazy, checkForUpdate"
  - "UpdateNotice and ServiceWorkerManager (not yet mounted; plan 05 mounts in Providers)"
affects: [03-05]
tech-stack:
  added: []
  patterns: ["pure core with zero imports tested by node --test"]
key-files:
  created: [src/lib/sw/updateCore.ts, src/lib/sw/register.ts, src/components/UpdateNotice.tsx, src/components/ServiceWorkerManager.tsx, tests/swUpdate.test.ts]
  modified: [mobile/www/index.html]
decisions:
  - "Update/reload paths re-check isRecordingActive() right before acting; recording shows notice only"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-01]
---

# Phase 3 Plan 03: SW client update flow Summary

Production-only SW registration (scope /, updateViaCache none; dev removes registrations and tr-* caches), recording-safe update notice, loop-guarded chunk-error recovery, and new APK first-launch-offline copy. 10 new tests pass, typecheck clean.

## Commits
- 77b6e1e: updateCore + tests
- b174ab6: register.ts, UpdateNotice, ServiceWorkerManager
- 276544e: mobile/www/index.html copy

## Deviations from Plan
None.

## Notes
- Providers.tsx untouched; ServiceWorkerManager must be mounted by plan 05.
- Only newly built APKs bundle mobile/www/index.html; old APKs keep the old text.

## Self-Check: PASSED
