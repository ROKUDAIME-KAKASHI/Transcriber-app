---
phase: 04-on-device-speaker-separation
plan: 03
subsystem: transcript-export-minutes
tags: [speakers, exports, minutes]
requires: []
provides: [speakerLabel, SpeakerNames, names-aware transcriptToText, ExportMeeting.speakerNames]
affects: [exports, process route]
key-files:
  modified:
    - src/lib/transcript.ts
    - src/lib/export/types.ts
    - src/lib/export/text.ts
    - src/lib/export/index.ts
    - src/lib/export/docx.ts
    - src/lib/export/html.ts
    - src/app/api/meetings/[id]/process/route.ts
  created:
    - tests/speakerLabel.test.ts
requirements: [SPK-03, SPK-04]
completed: 2026-11-21
---

# Phase 4 Plan 03: Speaker names in exports and minutes Summary

One `speakerLabel(n, names)` helper now feeds TXT, Word, PDF/HTML (HTML-escaped) and the AI minutes route, which also fixes per-chunk multiSpeaker and uses the D-12 prompt.

## Tasks
1. speakerLabel + names-aware transcriptToText + exporters (5 node tests pass).
2. Process route: withLegacyFallback select of speakerNames, meeting-level multiSpeaker, updated prompt.

## Deviations from Plan
None. The existing prompt text differed slightly from the plan's quoted lines; the equivalent sentences were replaced.

## Verification
typecheck, npm test (134 pass), build all pass. `Speaker ${` appears only in transcript.ts.

## Self-Check: PASSED
