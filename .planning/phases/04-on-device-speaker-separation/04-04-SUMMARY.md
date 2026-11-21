---
phase: 04-on-device-speaker-separation
plan: 04
subsystem: local-first sync
tags: [dexie, embeddings, sync, speakers]
requires: []
provides: [putEmbeddings, getEmbeddings, setRelabel, speakersRequest]
affects: [src/lib/local/types.ts, db.ts, repo.ts, syncCore.ts, sync.ts]
key-files:
  modified: [src/lib/local/types.ts, src/lib/local/db.ts, src/lib/local/repo.ts, src/lib/local/syncCore.ts, src/lib/local/sync.ts, tests/syncCore.test.ts]
requirements: [SPK-02, SPK-03]
---

# Phase 4 Plan 04: Embeddings storage and relabel sync Summary

Dexie v2 `embeddings` table plus a relabelPending flag, with the sync speakers step pushing refined labels through `/api/meetings/:id/speakers`.

## Tasks
1. Dexie v2 embeddings table, LocalEmbedding and relabelPending types, repo putEmbeddings/getEmbeddings/setRelabel; purge deletes embeddings; applySyncResult supports clearRelabel.
2. Pure `speakersRequest` (5 tests, parts capped at 60,000); sync speakers step uses it after the tail step and clears both flags on success or bad-request.

## Deviations
- [Rule 1] If getParts fails for a non-native relabel, the step falls back to names-only and keeps relabelPending set (only clears when the /speakers path was used or the row is native).
- Embeddings are never included in sync requests (T-04-09).

## Verification
typecheck, 139 tests, and build all pass.

## Self-Check: PASSED
