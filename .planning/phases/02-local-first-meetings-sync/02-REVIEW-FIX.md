---
phase: 02-local-first-meetings-sync
fixed_at: 2026-11-21T00:00:00Z
review_path: .planning/phases/02-local-first-meetings-sync/02-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Source review:** 02-REVIEW.md (Critical + Warning; Info skipped)
**Verification:** `npm run typecheck`, `node --test tests/syncCore.test.ts` (24/24 pass) and `npm run build` all pass.
Fixes were applied directly on `main` (no worktree), one local commit each. Nothing was pushed.

## Fixed Issues

### CR-01: Native-origin meetings never synced renames / speaker names
**Files:** `src/lib/local/sync.ts` — **Commit:** 2060c2c
Only the tail and finish steps are skipped for `origin === "native"`; meta and speakers now sync, so `pending` clears and "Generate minutes" works. (No new engine test added: `syncMeeting` is not unit-testable without a fetch/Dexie harness.)

### WR-01: Pull refetch capped at 5, never retried
**Files:** `src/lib/local/sync.ts` — **Commit:** c9beda7
`lastPullAt` only advances when every refetch finished (404 counts as done), so leftovers are returned by the next `?since=` pull.

### WR-02: Stale keepalive PATCH could truncate the server transcript
**Files:** `src/hooks/useRecorder.ts` — **Commit:** fdf0f69
Removed the fire-and-forget keepalive tail in local mode (data is already in IndexedDB; engine uploads it).

### WR-03: Non-atomic transcript read-modify-write
**Files:** `src/app/api/meetings/[id]/route.ts`, `src/app/api/meetings/[id]/speakers/route.ts` — **Commit:** 0085395
Optimistic concurrency: the write is conditioned on the `updatedAt` read earlier; on a miss it re-reads and recomputes (4 tries), then returns 503 (retryable). API contract unchanged. Requires human verification of the logic.

### WR-04: Poison/rejected meeting blocks or hammers sync
**Files:** `src/lib/local/sync.ts`, `src/lib/local/repo.ts`, `src/components/MeetingView.tsx` — **Commit:** d905cb8
Per-meeting server errors no longer stop the pass (only network failure does); rows with `syncError: "rejected"` are skipped until a new local edit clears it; a rejected meta/speakers PATCH drops its dirty flag so `finish` still runs; `setTitle` trims, caps at 200 and refuses empty; title input has `maxLength={200}`. Requires human verification of the logic.

### WR-05: Second tab could mark an active recording DONE
**Files:** `src/hooks/useRecorder.ts`, `src/lib/local/repo.ts` — **Commit:** a097edb
Recorder heartbeat (`touchRecording`, every autosave tick) refreshes `lastWriteAt`; orphan window raised from 30 s to 2 min.

### WR-06: Sign-out left engine running as previous user
**Files:** `src/components/SyncProvider.tsx`, `src/components/AppShell.tsx` — **Commit:** 91a3038
New `markSignedOut()` (called before explicit `signOut`) clears the last-user key and stops the engine. The local DB and unsynced data are kept (D-08). The offline/failed-session fallback is unchanged, so offline use is not broken.

### WR-07: Unpushed schema silently dropped speakerNames but returned success
**Files:** `src/app/api/meetings/[id]/route.ts`, `src/app/api/meetings/[id]/speakers/route.ts` — **Commit:** fdfc06c
In legacy/missing-column mode, requests carrying `speakerNames` now get 503 so the client keeps its dirty flag until the schema is pushed.

### WR-08: Native mirror rewrote transcript 4x/second after finish
**Files:** `src/hooks/useNativeRecorder.ts` — **Commit:** a9affb8
Final state is mirrored once per meeting id (`mirroredFinalRef`), reset on start.

## Skipped Issues

None in scope. Info findings IN-01..IN-03 were not attempted (out of scope).

---

_Fixer: Claude (gsd-code-fixer)_
