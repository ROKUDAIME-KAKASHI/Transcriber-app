---
phase: 02-local-first-meetings-sync
plan: 04
subsystem: recorder
tags: [offline, recorder, sync, dexie]
requires: [02-03]
provides:
  - Device-first start/save/stop in useRecorder with legacy server fallback
  - Native recorder mirrors service parts into the device store
  - Save badge Synced / Saved on this device
affects: [02-05]
key-files:
  modified:
    - src/hooks/useRecorder.ts
    - src/hooks/useNativeRecorder.ts
    - src/components/Recorder.tsx
key-decisions:
  - "Legacy save body became saveToServer (logic untouched); save() adds single-flight and routes to saveLocal or saveToServer"
requirements-completed: []
completed: 2026-11-21
---

# Phase 2 Plan 04: Recorder local-first Summary

On-device and Deepgram web recordings are created with a client id on the device first and autosaved to Dexie every 5 s (AUTOSAVE_MS unchanged); the sync engine does the server POST and tail PATCHes. With no local store the old awaited-POST path runs unchanged (body now also carries `id` and `engine`). Android native keeps the awaited POST before `MeetingRecorder.start`; JS only mirrors parts.

## Tasks

| Task | Commit |
|------|--------|
| 1 useRecorder local-first | b4ed982 |
| 2 Native mirror + Recorder badge | c3e68ad |

## Deviations from Plan

- The `visibilitychange` (hidden -> save()) listener already existed, so no new one was added.
- `discardEmptyLocal` purges the empty local row whenever a local user exists and no parts were captured (not only when `localModeRef` is set), so a cancel during the model download also leaves no empty meeting; purge of a missing row is harmless.
- In stop (local mode) saveState is set explicitly from the flush result, so the badge never stays on "Saving" if the sync state does not change.
- Fallback to saveToServer when a local write fails can 404 if the server row was never created; accepted as per the plan.

## Verification

`npm run typecheck`, `node --test tests/syncCore.test.ts` (24/24) and `npm run build` pass. Acceptance greps pass. Manual UAT not run.

## Manual UAT checklist

- Laptop: DevTools offline, record Moonshine ~1 min -> badge "Saved on this device · Waiting for internet" -> Stop -> "Saved on this device. It will upload when you're online." -> close tab, reopen /meetings -> meeting still listed.
- Online regression: web Deepgram and Moonshine show PATCH every ~5 s with `{transcriptTail, durationSec}`, badge "Synced", Stop -> "Saved to your account.".
- Phone (deferred): Android native Deepgram, screen locked 2+ min: request sequence unchanged apart from `id`/`engine` in POST; no 404s in the service status.

## Known Stubs

None. OFF-03 not marked complete (finishes in 02-05).

## Self-Check: PASSED
