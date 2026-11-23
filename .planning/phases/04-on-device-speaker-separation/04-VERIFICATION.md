---
phase: 04-on-device-speaker-separation
verified: 2026-11-23T00:00:00Z
status: human_needed
score: 5/5 truths verified in code (device-dependent behaviour deferred to HUMAN-UAT)
gaps: []
human_verification:
  - test: "Phone speed benchmark and no growing backlog on Xiaomi (SPK-05, UAT 1 and 8)"
    expected: "Mean embedMs acceptable, backlog never above 2, transcription does not lag"
    why_human: "Needs the physical phone and chrome://inspect"
  - test: "Offline live labels, refinement saved and visible on laptop, rename survives refinement (UAT 2-6)"
    expected: "Labels appear offline; refined labels sync; names persist on the same voice and in all exports"
    why_human: "Real audio, real models, device and cross-device behaviour"
  - test: "AI minutes attribution on 2-speaker and long meetings (UAT 7)"
    expected: "Statements, decisions, actions attributed to names"
    why_human: "LLM output quality"
  - test: "Deepgram unchanged, old APK and website compatibility, threshold tuning (UAT 9-11)"
    expected: "No regressions"
    why_human: "Runtime and device checks"
---

# Phase 4: On-Device Speaker Separation Verification Report

**Goal:** On-device engines say who said what, on the device, without slowing live transcription.
**Status:** human_needed (no code gaps found)

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | Live per-phrase labels computed on device | VERIFIED (code) | `speech.worker.ts` embedding model (WeSpeaker) with `load-speaker`/`embedding` messages; `useRecorder.ts` assigns labels via `assignOnline`/`mapToLive` from `diarize.ts`; `embedSchedule.ts` rules; `readiness.ts` includes speaker model for offline download |
| 2 | Labels refined after stop and saved | VERIFIED (code) | `refineSpeakers()` in `useRecorder.ts` (refine + compactLabels + name remap) called from stop; Dexie embeddings and `setRelabel`; `sync.ts` `speakersRequest` pushes to `/api/meetings/[id]/speakers` (route exists) |
| 3 | Rename once, applies to transcript, exports, minutes | VERIFIED (code) | `renameSpeaker` in `useRecorder.ts`; `MeetingView.tsx` rename and `speakerNames` persisted via meeting route (schema `speakerNames Json?`); `speakerLabel` used in `transcript.ts`, `export/docx.ts`, `export/html.ts`, `export/text.ts`; Recorder passes names/rename to TranscriptView |
| 4 | AI minutes attribute to speakers | VERIFIED (code) | `process/route.ts` loads `speakerNames`, builds text with names, D-12 prompt, labels kept across chunks |
| 5 | Keeps up on Xiaomi phone | UNCERTAIN (device) | Worker puts embeddings at lowest priority with crop shrink on slow devices (`embedSchedule`, `cropSec`); laptop benchmark in 04-BENCHMARK.md; phone confirmation requires UAT 1 and 8 |

## Automated checks
- `npm run typecheck`: clean.
- `npm test`: 141 tests, 141 pass, 0 fail.
- Debt-marker scan (TBD/FIXME/XXX) in core phase files: none.

## Requirements Coverage
SPK-01..SPK-05: implementation evidence found for all (SPK-05 pending device confirmation).

## Housekeeping notes (non-blocking)
- ROADMAP.md still shows Phase 4 as "1/8 plans executed" with 04-02..04-08 unchecked, and REQUIREMENTS.md has SPK-03 and SPK-04 as Pending, although code and summaries exist. Update on phase completion.

## Gaps Summary
No code gaps. Phase awaits the device and cross-device checks in 04-HUMAN-UAT.md.

_Verifier: Claude (gsd-verifier)_
