---
phase: 04-on-device-speaker-separation
plan: 07
subsystem: recorder
tags: [diarization, useRecorder, dexie, sync]
requires: [04-01, 04-02, 04-04]
provides: [live speaker labels, stop-time refinement, renameSpeaker, speakerStatus]
key-files:
  modified: [src/hooks/useRecorder.ts, src/hooks/useNativeRecorder.ts]
requirements-completed: [SPK-01, SPK-02, SPK-03, SPK-05]
---

# Phase 4 Plan 07: Recorder diarization wiring Summary

On-device recordings (Moonshine/Whisper) now get live speaker labels from online centroid assignment, refined at stop with names remapped, saved and synced via the relabel flag; renameSpeaker works live.

## What was built
- transcribeFinal(audio, {embed}) for phrases >= 1 s when the speaker model is ready; job id -> part index map with early-vector stash; short/skipped parts inherit the previous speaker; labels propagate to following vector-less parts.
- Speaker model load is fire-and-forget (never delays start); Deepgram paths untouched.
- Embeddings buffered and written via putEmbeddings every autosave tick or 10 rows (never sent to the server).
- stop(): drainEmbeddings(10 s), refine -> mapToLive -> compactLabels, remapNames, setRelabel before save("DONE"); non-local mode PATCHes /speakers after the final save. All wrapped in try/catch.
- RecorderState gains speakerNames and speakerStatus; hook returns renameSpeaker.

## Deviations
- [Rule 3] useNativeRecorder.ts initial state needed the two new RecorderState fields to typecheck.
- Both tasks touch one file and were committed together as a single commit.

## Verification
typecheck, npm test (141 pass), npm run build all pass. Not device-tested.

## Self-Check: PASSED
