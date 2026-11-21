---
phase: 01-export-share-navigation
plan: 04
subsystem: share
tags: [share, capacitor, overlay, ui]
requires: ["01-01", "01-03"]
provides:
  - src/components/ShareMenu.tsx (sheet below lg, popover at lg+)
  - MeetingView runShare/runCopy wired to the share menu
affects: []
tech-stack:
  added: []
  patterns: ["overlay registry registration for back-button close", "feature-detected native share with clipboard fallback"]
key-files:
  created:
    - src/components/ShareMenu.tsx
  modified:
    - src/components/MeetingView.tsx
    - src/components/ui.tsx
    - package.json
    - package-lock.json
decisions:
  - "Share rows use PDF in the APK (Word if PDF plugin missing) and Word on web, since a web PDF is a print dialog"
  - "Button gained a ref prop (React 19 ref-as-prop) so the share button can be the menu anchor"
metrics:
  tasks: 2
  completed: 2026-11-21
requirements: [SHARE-04, SHARE-05, NAV-03]
---

# Phase 1 Plan 04: Share menu Summary

"Share meeting" now opens a menu (bottom sheet with scrim below lg, popover at lg+) with Share minutes/report, Share transcript and Copy text. It registers with the overlay stack so Android back closes it first. html2pdf.js is removed.

## Commits
- 2554e4f: ShareMenu, MeetingView runShare/runCopy, Button font-semibold and ref prop
- bfdec45: remove html2pdf.js dependency

## Deviations from Plan
- [Rule 3 - Blocking] Added `ref?: Ref<HTMLButtonElement>` to `ButtonProps` in ui.tsx; typecheck failed without it. The font-semibold change from Task 2 landed in the Task 1 commit because it touched the same file.
- The Export panel renders twice in the layout (one copy hidden by CSS when there is no document), so two ShareMenu instances exist but only the visible one shows.

## Verification
- `npm run typecheck` and `npm run build` pass; no html2pdf in src or package.json; node_modules/html2pdf.js gone.
- Not run: browser and device checks (popover/sheet behaviour, Android chooser, back order); no adb per rules. No cap sync, deploy or push.

## Known Stubs
None.

## Self-Check: PASSED
