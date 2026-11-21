---
phase: 04-on-device-speaker-separation
plan: 01
subsystem: speech
tags: [diarization, wespeaker, clustering, benchmark]
requires: []
provides:
  - "src/lib/speech/diarize.ts pure clustering (createOnline, assignOnline, refine, mapToLive, compactLabels, remapNames, constants, SpeakerStatus)"
  - "scripts/diarize-bench.mjs speed + clustering spike"
  - "04-BENCHMARK.md measured numbers, 04-HUMAN-UAT.md phone item"
affects: [04-05, 04-07, 04-08]
tech-stack:
  added: []
  patterns: ["zero-import erasable-TS pure module tested with node --test"]
key-files:
  created:
    - scripts/diarize-bench.mjs
    - src/lib/speech/diarize.ts
    - tests/diarize.test.ts
    - .planning/phases/04-on-device-speaker-separation/04-BENCHMARK.md
    - .planning/phases/04-on-device-speaker-separation/04-HUMAN-UAT.md
  modified: [.gitignore]
key-decisions:
  - "LIVE_THETA 0.45 (measured; CONTEXT default 0.55 over-splits noisy 3 s crops)"
  - "AHC_THRESHOLD kept 0.70; 0.60 slightly better on LibriSpeech, revisit after phone UAT"
  - "Crop 6 s normal, 3 s slow devices, skip < 1 s"
requirements-completed: [SPK-01, SPK-02, SPK-05]
duration: ~25 min
completed: 2026-11-21
---

# Phase 4 Plan 01: Speaker clustering core and spike Summary

Measured WeSpeaker q8 speed (about 125 ms per audio second on WASM 1 thread, laptop) and clustering quality on real LibriSpeech audio, then built the pure, tested online + stop-time AHC clustering module the later plans import.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Spike script, benchmark, UAT item | 7142cb2 | Ran clean and degraded; about 12 MB downloaded to a temp cache outside the repo |
| 2 diarize.ts + 14 node tests | 7dcd259 | Tests green; refine on 3,000 vectors about 250 ms; `--app` bench confirms production code matches reference |

## Verification

typecheck, `npm test` (124 pass), `npm run build` all pass.

## Deviations from Plan

None. Notes: the scratch scripts still existed and were merged; the research claim that AHC 0.7 gives ARI 1.00 on degraded 3 s was not reproduced exactly (0.97, 5 speakers found, two similar voices merge), recorded in 04-BENCHMARK.md. Constants kept as planned.

## Known Stubs

None.

## Self-Check: PASSED
