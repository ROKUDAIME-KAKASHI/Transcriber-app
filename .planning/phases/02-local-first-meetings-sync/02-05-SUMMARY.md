---
phase: 02-local-first-meetings-sync
plan: 05
subsystem: meetings-ui
tags: [offline, dexie, meetings, sync]
requires: [02-03]
provides:
  - Meetings list merged with device meetings and sync badges
  - Local-first rename/delete in MeetingView with server fallback
  - AI minutes wait for a complete upload (flush) and are cached on the device
  - /meetings/<id> falls back to the device copy (LocalMeetingView)
affects: []
key-files:
  created:
    - src/components/LocalMeetingView.tsx
  modified:
    - src/components/MeetingList.tsx
    - src/components/MeetingView.tsx
    - src/app/meetings/[id]/page.tsx
key-decisions:
  - "Server props stay the base of the list so SSR and first client render match; device state layers on after mount"
requirements-completed: [OFF-03]
completed: 2026-11-21
---

# Phase 2 Plan 05: Meetings UI on the device store Summary

The Meetings list shows device-only meetings ("Not synced yet" / "Couldn't sync"), hides device-deleted ones, and keeps local edits until synced. MeetingView renames and deletes through Dexie plus `poke`, flushes the upload before generating minutes, stores generated documents locally (never pushed), and caches the server copy. The meeting page renders `LocalMeetingView` when the server row is missing or the DB read fails.

## Tasks

| Task | Commit |
|------|--------|
| 1 Merge device meetings into list | bd769ee |
| 2 MeetingView local-first + flush before generate | bfce140 |
| 3 Page fallback + LocalMeetingView | bc050e3 |

## Deviations from Plan

None - plan executed as written (merged list variable is named `merged`; the upstream prop was renamed `serverMeetings`).

## Verification

`npm run typecheck`, `node --test tests/syncCore.test.ts` (24 pass) and `npm run build` all pass.

## User action required

Run `npx prisma db push` against Neon before or with deploying (not run by Claude). Then run the manual UAT checklist from 02-RESEARCH.md "Manual Verification Checklist".

## Self-Check: PASSED
