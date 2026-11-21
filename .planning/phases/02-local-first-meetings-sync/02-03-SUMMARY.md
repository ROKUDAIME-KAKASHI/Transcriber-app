---
phase: 02-local-first-meetings-sync
plan: 03
subsystem: sync
tags: [sync, offline, web-locks, react-hooks]
requires: [02-01, 02-02]
provides:
  - Singleton sync engine (push create -> tail -> meta -> speakers -> finish -> delete, then pull)
  - SyncProvider binding the effective user to the local DB and engine
  - useSyncStatus / useMeetingSync hooks
affects: [02-04, 02-05]
tech-stack:
  added: []
  patterns: ["Web Locks ifAvailable + in-tab mutex with rerun flag", "cursor persisted after every confirmed batch"]
key-files:
  created:
    - src/lib/local/sync.ts
    - src/components/SyncProvider.tsx
    - src/hooks/useSync.ts
  modified:
    - src/components/Providers.tsx
    - src/lib/local/repo.ts
    - src/lib/local/types.ts
key-decisions:
  - "Added optional LocalMeeting.lastWriteAt (non-indexed, no Dexie schema bump) so recoverOrphans skips meetings written in the last 30 s"
requirements-completed: []
duration: 15min
completed: 2026-11-21
---

# Phase 2 Plan 03: Sync engine Summary

One engine per user pushes pending local meetings in D-05 order with persisted tail cursors, pulls with the server clock, pauses (never deletes) on 401, backs off on 5xx/network errors, never tail-pushes native rows, and exposes `flush(id)`; SyncProvider starts it for the session (or last known) user and recovers orphaned recordings.

## Tasks

| Task | Commit |
|------|--------|
| 1 Sync engine (+ lastWriteAt in repo/types) | 084ce72 |
| 2 SyncProvider, Providers wiring, hooks | 343960a |

## Deviations from Plan

**1. [Rule 2 - Missing functionality] lastWriteAt field.** The plan requires recoverOrphans to skip meetings with a write under 30 s old, but LocalMeeting had no write timestamp. Added optional `lastWriteAt` (set in createLocal and putParts) and the check in recoverOrphans. Not indexed, so no Dexie version change.

OFF-03 is not marked complete (finishes in 02-05, per instruction).

## Verification

`npm run typecheck`, `node --test tests/syncCore.test.ts` (24/24) and `npm run build` pass. Manual offline/online UAT not run.

## Known Stubs

None.

## Self-Check: PASSED
