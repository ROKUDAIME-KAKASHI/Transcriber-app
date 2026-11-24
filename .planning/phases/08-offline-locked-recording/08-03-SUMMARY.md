---
phase: 08
plan: 03
subsystem: recorder-integration
requirements: [OFF-V2-01]
key-files:
  created: [src/lib/speech/nativeSession.ts, tests/nativeSession.test.ts]
  modified:
    - src/hooks/useRecorder.ts
    - src/hooks/useNativeRecorder.ts
    - src/hooks/useBackgroundRecording.ts
    - src/components/Recorder.tsx
    - src/lib/local/repo.ts
    - src/lib/local/types.ts
    - src/lib/speech/voiceChunker.ts
    - tests/voiceChunkerFeed.test.ts
---
# Phase 8 Plan 03: Recorder integration Summary

In the Android app (new APK), an on-device recording now starts the native `mode: "local"` service and `useRecorder` transcribes the audio it writes; the website and old APKs still take the getUserMedia path. `npx tsc --noEmit`, `npm test` (221) and `npm run build` pass.

## What was built
- `useRecorder` native session (`startNative`, `runPump`, `nativeTick`, `attachNative`, `attachExisting`, `resumeNative`, `stopNative`, `detachNative`). Capability gate: `isNativeApp()` + `nativeCapabilities().localCapture` + a device store; anything else falls through unchanged. The `onSegment` body and the model/speaker-model loading were extracted (`onPhrase`, `prepareOnDevice`) so both paths share them.
- Pump: `readAudio` (2 s live, 10 s when more than 3 s behind) -> `frameBlock` -> feed-mode chunker. Catch-up is paced by promises (finished phrases, then `drainEmbeddings`), embeddings use `batch: true`, live previews are off while behind, status shows "Catching up · N min of audio left (about M min)" from `RateMeter`.
- Committed cursor: `committedCursor({readPos, chunker.openStart(), in-flight first samples})`; `onSegment` got a 4th argument (first sample incl. preroll). `putParts(..., native: {nativeCursor, finishNative})` writes the cursor (monotonic) in the same Dexie transaction as the parts; `releaseAudio` is called only after that write resolves.
- Dexie: `nativeCapture?: 0|1`, `nativeCursor?: number` (not indexed, no version bump). `recoverOrphans` skips `nativeCapture === 1`.
- Leaving Record detaches: timers stop, in-flight phrases are finished, a last cursor is saved, capture continues in the service; a module-level barrier makes the next mount wait. Mounting calls `listCaptures()` and re-attaches a live capture (replaying saved parts and embeddings, resuming from `max(nativeCursor, committed)`); it never calls `start()`.
- Pause/resume/stop from the Record controls and the phone bar work for the native session (same service); Stop drains to the service's `ended`, flushes, awaits finals, refines speakers, writes DONE.
- `useNativeRecorder.apply` ignores `mode === "local"`; `BackgroundRecording` carries `mode`. Recorder copy, battery banner, mic field and a "finishing" flag (no "Meeting saved" link while draining) for the offline-capable app.

## Pitfalls
1 gated by capabilities; 2 cloud UI ignores local; 3 resume uses listCaptures; 4 cursor atomic with parts, release after write, orphan skip, detach not stop; 5 batch embeddings, previews off, estimate shown.

## Deviations
- [Rule 2] Commit attribution uses the harness line (Claude Sonnet 5.5) rather than "Opus 5.5".
- Wake lock: the screen wake lock is still taken while visible (live transcript), it simply releases on lock.

## Known limits
Remote stop is only noticed while the Record screen is mounted. No device test yet (08-HUMAN-UAT.md).
