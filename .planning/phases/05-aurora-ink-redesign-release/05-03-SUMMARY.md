---
phase: 05-aurora-ink-redesign-release
plan: 03
subsystem: ui
tags: [shell, glass-tab-bar, page-enter, recording-pill, login, offline]
requires: [05-01, 05-02]
provides:
  - Glass floating tab bar, restyled sidebar/top bar, non-remounting page-enter animation
  - Offline pill (warning-soft, pop-in) with "Back online" toast
  - useBackgroundRecording hook and RecordingPill (native-only, read-only)
  - Restyled Login and Offline pages
key-files:
  created: [src/hooks/useBackgroundRecording.ts, src/components/RecordingPill.tsx]
  modified: [src/components/AppShell.tsx, src/components/ConnectivityPill.tsx, src/components/UpdateNotice.tsx, src/app/login/page.tsx, src/app/offline/page.tsx]
requirements-completed: [UI-01, UI-02, UI-03, UI-05]
completed: 2026-11-23
---

# Phase 5 Plan 03: App Chrome Summary

Aurora Ink chrome: floating glass tab bar, accent sidebar, page-enter via el.animate (no remount), offline pill with Back online toast, a glass recording pill driven by a read-only native poll, and restyled Login/Offline pages.

## Commits
1. 94644d2 - AppShell, ConnectivityPill, UpdateNotice
2. 195c732 - useBackgroundRecording, RecordingPill
3. b5ce334 - login and offline pages

## Deviations from Plan
Task 1's AppShell commit already imports and mounts RecordingPill (same file is in tasks 1 and 2), so commit 94644d2 alone does not typecheck; the tree is green from 195c732 on.

## Verification
npm run typecheck clean; npm test 153 pass, 0 fail. Build deferred to 05-07. Hook never calls start/stop/pause/resume (grep clean).

## Known Stubs
None.

## Self-Check: PASSED
