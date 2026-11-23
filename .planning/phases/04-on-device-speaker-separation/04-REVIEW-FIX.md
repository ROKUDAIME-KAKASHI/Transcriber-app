---
phase: 04-on-device-speaker-separation
fixed_at: 2026-11-23T00:00:00Z
review_path: .planning/phases/04-on-device-speaker-separation/04-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Source review:** .planning/phases/04-on-device-speaker-separation/04-REVIEW.md
**Iteration:** 1

Checks after fixes: `npm run typecheck` clean, `npm test` 141/141 pass, `npm run build` succeeds.
Fixes were applied directly on `main` (no separate worktree) so the checks could use the installed `node_modules`.

## Fixed Issues

### WR-01: Stop path delayed persisting final phrases
**Files:** `src/hooks/useRecorder.ts` | **Commit:** d030682
`stop()` now runs `save()` (device-first checkpoint) before `refineSpeakers()`. The final `save("DONE")` re-sends the relabelled parts.

### WR-02: Relabel flag set before refined parts written
**Files:** `src/hooks/useRecorder.ts`, `src/lib/local/repo.ts` | **Commit:** 3c365e7
`refineSpeakers` no longer calls `setRelabel`. It stores the names in `pendingRelabelRef`, and the next `putParts` writes parts, `speakerNames`, `relabelPending` and `dirty.speakers` in one Dexie transaction. Requires human verification (logic change).

### WR-03: clear-speakers race and dropped relabel on unreadable parts
**Files:** `src/lib/local/types.ts`, `src/lib/local/repo.ts`, `src/lib/local/sync.ts` | **Commit:** 388772e
Added `speakersRev`, bumped by `setSpeakerNames`, `setRelabel` and the relabel path in `putParts`. `applySyncResult` keeps `dirty.speakers` and `relabelPending` if the rev changed during the request. When a relabel is pending and parts cannot be read, the sync step now retries instead of sending names only. The meta-step race mentioned in the review was not changed (only the speakers step was fixed). Requires human verification.

### WR-04: Server-direct relabel push was fire-and-forget
**Files:** `src/hooks/useRecorder.ts` | **Commit:** 4a32b68
The `/speakers` PATCH is now awaited with up to 3 attempts (retry on network error, 5xx, 408, 429).

### WR-05: Speaker model load ran outside the scheduler
**Files:** `src/workers/speech.worker.ts` | **Commit:** 2b3038a
Session creation and warm-up wait until the worker is idle (`untilIdle`). A `speakerBusy` flag keeps phrases that overlapped the load out of `trackSpeed`. Download of the feature extractor is still immediate (async I/O only). Requires human verification on a device.

### WR-06: Rename sheet anchored by shifting paragraph index
**Files:** `src/components/TranscriptView.tsx` | **Commit:** 0dfa49c
`renaming` is now keyed by speaker id. The sheet renders at the first visible chip for that speaker, and focus returns to that chip on close.

### WR-07: Embeddings not deleted on pulled removal
**Files:** `src/lib/local/repo.ts` | **Commit:** e2bca84
`applyPull`'s `remove` branch now deletes the meeting's embeddings in the same transaction. Embedding persistence itself was kept (a retention rule or consumer is a product decision).

## Skipped Issues

None.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
