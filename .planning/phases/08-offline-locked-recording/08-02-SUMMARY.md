---
phase: 08
plan: 02
subsystem: speech-pipeline
requirements: [OFF-V2-01]
key-files:
  created: [src/lib/speech/nativeFeed.ts, tests/nativeFeed.test.ts, tests/voiceChunkerFeed.test.ts]
  modified:
    - src/lib/speech/voiceChunker.ts
    - src/lib/speech/resampler.ts
    - src/lib/speech/embedSchedule.ts
    - src/lib/speech/client.ts
    - src/workers/speech.worker.ts
    - src/lib/nativeRecorder.ts
    - tests/embedSchedule.test.ts
---
# Phase 8 Plan 02: Pure JS core + worker batch flag Summary

Feed-mode VoiceChunker, `nativeFeed.ts` helpers, the embedding `batch` flag and `nativeCapabilities()` are in place with tests; `npm test` is 212/212, `tsc` and `npm run build` pass.

## What was built
- `nativeFeed.ts`: `pcm16Base64ToFloat32`, `frameBlock` (640-sample frames, cuts at breaks so the frame after a break starts on it), `committedCursor`, `isCatchingUp`, `readSizeFor`, `catchUpText`, `describeAudio`, `RateMeter`, `interpretCapabilities`.
- `VoiceChunker.forFeed(events, startAt)`, `feed()`, `breakAt(abs)`, `openStart()`; the constructor now takes `AudioContext | null`. Web behavior unchanged.
- `embedDecision({ batch })`: batch skips only "short"/"unavailable", never "backlog"/"slow". Plumbed via worker `transcribe` message and `transcribeFinal(audio, { embed, batch })`.
- `nativeRecorder.ts`: new types and `nativeCapabilities()`.

## Deviations
- [Rule 3] `voiceChunker.ts` imports `./resampler.ts` and both `VoiceChunker`/`Resampler` constructors no longer use TypeScript parameter properties, because node's strip-only TS loader (used by `npm test`) rejects them. Behavior identical.

## Verification
`npm test` 212 pass, `npx tsc --noEmit` clean, `npm run build` OK.
