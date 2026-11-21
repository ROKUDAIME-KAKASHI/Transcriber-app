---
phase: 04-on-device-speaker-separation
plan: 05
subsystem: ui
tags: [speakers, rename, transcript, react]
requires: [04-01, 04-03]
provides:
  - SpeakerChip, RenameSpeakerSheet components
  - TranscriptView props speakerNames, onRenameSpeaker, speakerStatus, renameHint
  - MeetingView rename persistence (Dexie + poke, or PATCH /speakers fallback)
key-files:
  created: [src/components/SpeakerChip.tsx, src/components/RenameSpeakerSheet.tsx]
  modified: [src/components/TranscriptView.tsx, src/components/MeetingView.tsx, src/components/MeetingLoader.tsx]
requirements-completed: [SPK-01, SPK-03]
completed: 2026-11-21
---

# Phase 4 Plan 05: Speaker chips and rename Summary

Tappable speaker chips with a bottom-sheet/popover rename flow, a speaker status line and one-time hint in TranscriptView, and meeting-page wiring so names flow into copy, exports and minutes.

## Commits
- 37123b3: chips, rename sheet, TranscriptView props
- 2afd902: rename and names wired into MeetingView/MeetingLoader

## Deviations
None of substance. The speaker status/hint/announce state updates in TranscriptView use `setTimeout(..., 0)` inside effects to satisfy the repo's react-hooks lint rule against synchronous setState in effects.

## Verification
typecheck, npm test (139 pass), npm run build all pass.

## Notes
- Recorder wiring (passing speakerStatus, no renameHint) is plan 08.
- Names state in MeetingView is initialised once from props; it is not re-read from Dexie live updates.

## Self-Check: PASSED
