---
phase: 03-offline-app-shell-gating
plan: 07
subsystem: offline-gating
tags: [feature-gate, recorder, option-list, offline-model]
requires: ["03-02", "03-04", "03-06"]
provides:
  - "OptionList per-option disabled and GateReason component"
  - "AI minutes button gated by useFeatureGate('ai')"
  - "Recorder effective engine (saved Cloud choice falls back to on-device offline, never overwritten)"
  - "OfflineModelControl mounted on Record with offline Start gate"
affects: [03-08]
key-files:
  modified: [src/components/ui.tsx, src/components/MeetingView.tsx, src/components/Recorder.tsx]
decisions:
  - "Engine is frozen for the session while starting/recording (ref holds the last pre-lock effective engine), so connectivity flips never alter a recording"
  - "Cloud and AI gates enforce UI only; server routes still authorise (T-03-24)"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-05, OFF-02]
---

# Phase 3 Plan 07: Cloud/AI gating and offline model UI Summary

Offline, the Cloud option and Create/Regenerate minutes are disabled with a visible reason ("Needs internet") and re-enable on their own. A saved Cloud choice records on-device for the session with a neutral notice, without touching the saved preference, and the APK no longer starts the native Deepgram recorder offline. On-device engines show the "Keep the screen on" note, the Offline use download control, a "Ready offline" suffix, and Start is disabled offline when the model is not cached.

## Commits
- 054121d: ui.tsx primitives and MeetingView AI gate
- fc838ea: Recorder effective engine, gated Cloud option, honest copy
- cbfdea5: OfflineModelControl mount, Start gate, Ready offline suffix

## Deviations from Plan
- [Rule 1] `effectiveEngine` with `locked: true` returns the saved engine, which would flip an overridden (offline Cloud to on-device) recording back to Cloud at start. The Recorder therefore computes the effective engine unlocked and freezes it in a ref once a session starts or runs. Lock state comes from an effect on `busy || starting`, because the lock depends on the recorder hook that consumes the engine.
- Added a `lastOnDeviceEngine` localStorage key (written on on-device selection).

## Known Stubs
None.

## Verification
typecheck, npm test (110 pass), npm run build and scripts/check-build.mjs pass. Not tested on a device or in a browser offline.

## Self-Check: PASSED
