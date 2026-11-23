---
phase: 05-aurora-ink-redesign-release
plan: 04
subsystem: ui
tags: [recorder, orb, calm-mode, aurora-ink, haptics]
requires: [05-01, 05-02]
provides:
  - src/lib/calmMode.ts (pure calm-mode decision, tested)
  - src/components/Orb.tsx (mic-reactive aurora orb, single throttled rAF loop)
  - Recorder.tsx Aurora Ink hero, Options disclosure, calm mode, glass recording bar, Jump to live
key-files:
  created: [src/lib/calmMode.ts, tests/calmMode.test.ts, src/components/Orb.tsx]
  modified: [src/components/Recorder.tsx]
requirements-completed: [UI-02, UI-03, UI-05]
duration: 15min
completed: 2026-11-23
---

# Phase 5 Plan 04: Record Screen Summary

Record hero with a mic-reactive aurora orb, a single record/stop button that morphs (88 px circle to 72 px rounded square with live ring), mono timer, scrolling waveform, sliding engine Segmented, and calm mode that stops animation after 10 minutes, on low battery or when hidden.

## Tasks
1. calmMode (TDD, 8 tests) + Orb - fb941f3
2. + 3. Hero, Segmented engine picker, Options disclosure (language, mic, tab audio, screen notes, Reduce motion switch), calm mode wiring (visibility, getBattery, tap-to-boost 60 s), glass phone bar shown only when the hero is off screen, Jump to live, haptics, "Synced" toast - single commit (both tasks edit the same file in one rewrite)

## Deviations from Plan
- Tasks 2 and 3 landed in one commit rather than two, because Recorder.tsx was restructured in one pass. No scope change.
- NoSoundNotice switched to tone "warning" (Task 3 spec) so the old danger tone is no longer used there.

## Verification
npm run typecheck clean; npm test 161 pass, 0 fail; acceptance greps all match; git diff on src/hooks, src/lib/speech, src/lib/nativeRecorder.ts empty. Build deferred to 05-07. No device test of animation performance yet.

## Known Stubs
None.

## Self-Check: PASSED
