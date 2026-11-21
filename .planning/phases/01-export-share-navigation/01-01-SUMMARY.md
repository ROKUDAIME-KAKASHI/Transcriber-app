---
phase: 01-export-share-navigation
plan: 01
subsystem: navigation
tags: [capacitor, navigation, android-back, native-detection]
requires: []
provides:
  - src/lib/native.ts capability layer (hasPlugin, lazy plugin getters, DocumentExport, cleanupOldExports)
  - navStack/navBack, overlays registry, recordingFlag
  - all milestone native plugins and export deps installed
affects: [01-02, 01-03, 01-04]
tech-stack:
  added: ["@capacitor/share 8.0.3", "@capacitor/filesystem 8.1.5", "@capacitor/app 8.1.2", "@capacitor/network 8.0.1", "@capacitor/haptics 8.0.2", "docx 9.16.0", "mdast-util-from-markdown 2.1.0", "mdast-util-gfm 3.1.0", "micromark-extension-gfm 3.0.0", "@types/mdast 4.0.4"]
  patterns: ["hasPlugin = isNative && isPluginAvailable", "in-app nav stack instead of history.length"]
key-files:
  created: [src/lib/navStack.ts, src/lib/native.ts, src/lib/overlays.ts, src/lib/recordingFlag.ts, src/components/NavTracker.tsx, src/components/NativeBackHandler.tsx]
  modified: [package.json, package-lock.json, src/components/Providers.tsx, src/components/AppShell.tsx, src/components/MeetingView.tsx, src/components/Recorder.tsx]
decisions:
  - "In-app navStack tracker replaces history.length/referrer for back-arrow logic"
  - "NativeBackHandler mounted at root Providers so /login is covered"
metrics:
  completed: 2026-11-21
  tasks: 2
---

# Phase 1 Plan 01: Navigation and native capability layer Summary

Brand link to Record, history-aware meeting back arrow, and an Android back-key handler (overlay, then parent route, then minimize while recording or exit), built on a new feature-detected `native.ts` layer with all milestone plugins pinned.

## Commits
- c61ab18: Task 1, brand link and back arrow
- dc84755: Task 2, plugins, native.ts, back handler

## Deviations from Plan
None. Provenance checked via `npm view repository.url` (ionic-team / dolanmiu) before install. html2pdf.js left in place; `cap sync` not run (plan 01-02).

## Verification
`npm run typecheck` and `npm run build` pass. No static plugin imports outside native.ts. Device checks (Android back key) not run (no adb per rules).

## Known Stubs
None.

## Self-Check: PASSED
