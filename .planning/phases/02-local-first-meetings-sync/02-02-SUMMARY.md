---
phase: 02-local-first-meetings-sync
plan: 02
subsystem: local-data
tags: [dexie, indexeddb, sync, offline]
requires: []
provides:
  - Per-user Dexie database and repo (only IndexedDB writer)
  - Pure syncCore (batching, backoff, pending/tail guard, pull merge)
  - Connectivity probe (isReachable, markUnreachable, onConnectivityHint)
affects: [02-03, 02-04, 02-05]
tech-stack:
  added: [dexie 4.4.7, dexie-react-hooks 4.4.0]
  patterns: ["pure syncCore tested via node --test type stripping", "repo never throws"]
key-files:
  created:
    - src/lib/local/types.ts
    - src/lib/local/ids.ts
    - src/lib/local/syncCore.ts
    - src/lib/local/db.ts
    - src/lib/local/repo.ts
    - src/lib/connectivity.ts
    - tests/syncCore.test.ts
  modified: [package.json, package-lock.json, tsconfig.json]
key-decisions:
  - "Transcript parts live in a sibling `transcripts` table (one row per meeting, same id, written in the same rw transaction) so list live-queries never deserialize transcripts"
  - "mergePulledMeeting keeps the old serverUpdatedAt while a refetch is owed, so a failed refetch is retried on the next pull"
  - "mergePulledMeeting always returns `next` (even for action skip)"
requirements-completed: []
duration: 15min
completed: 2026-11-21
---

# Phase 2 Plan 02: Local data layer Summary

Device-side store: Dexie database `transcriber-<userId>` with meetings/transcripts/kv, a repo that never throws, and a unit-tested pure `syncCore` holding the cursor, merge and backoff rules.

## Tasks

| Task | Commit |
|------|--------|
| 1 Dexie, types/ids, syncCore + tests (24 passing) | 9b89a57 |
| 2 Dexie db and repo | 5f303be |
| 3 Connectivity probe | cae3d92 |

Test command: `npm test` (= `node --test tests/syncCore.test.ts`). `tests` is excluded from tsconfig.

## Deviations from Plan

- TDD RED run was not committed separately; tests and implementation were committed together in Task 1 (tests were written before the implementation).
- `mergePulledMeeting` returns `next` for skip results too (tests read it); `requirements-completed` left empty as OFF-03 finishes in 02-05.
- Dexie installed as `^4.4.7` / `^4.4.0` (npm default range).

## Threat notes

T-02-08 mitigated by per-user DB name; T-02-09 accepted (IndexedDB is unencrypted at rest on the device).

## Known Stubs

None.

## Self-Check: PASSED (typecheck, 24/24 tests, build all green)
