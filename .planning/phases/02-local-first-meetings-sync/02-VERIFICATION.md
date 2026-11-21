---
phase: 02-local-first-meetings-sync
verified: 2026-11-21T00:00:00Z
status: human_needed
score: 4/4 must-haves verified (code level); runtime behaviour needs device/browser confirmation
overrides_applied: 0
human_verification:
  - test: "Airplane-mode record/edit, close and reopen the app (browser and APK)"
    expected: "Meeting and its transcript are still listed and openable from the device store with a pending sync badge"
    why_human: "Needs real IndexedDB persistence across app restarts"
  - test: "Restore connectivity, then open the meeting from a laptop browser"
    expected: "Meeting appears on the server on its own, full text, exactly one row"
    why_human: "Needs live Neon DB and two clients"
  - test: "Kill the app mid-sync, and trigger two syncs of the same meeting; generate AI minutes on the server then sync from the device"
    expected: "Transcript is never truncated or duplicated; minutes are not overwritten by the device"
    why_human: "Needs live DB and process kill"
  - test: "Record online with Deepgram and with an on-device engine"
    expected: "Autosave behaves as before (save badge, transcript saved on stop)"
    why_human: "Needs microphone, engines and a live server"
  - test: "Apply the schema change (titleUpdatedAt) to the DB by the owner's usual process"
    expected: "Server selects work without the P2022 legacy fallback"
    why_human: "prisma db push is forbidden for the verifier; the code falls back to legacy columns until it is applied"
---

# Phase 2: Local-First Meetings & Sync Verification Report

**Phase Goal:** Every meeting is stored on the device first and reaches the server reliably, with no duplicates and no lost text
**Status:** human_needed (no code gaps found)
**Re-verification:** No

## Automated checks
| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `node --test tests/syncCore.test.ts` | 24 pass, 0 fail |
| `npm run build` | succeeds; routes include /api/health, /api/meetings, /api/meetings/[id], speakers |
| Debt markers (TODO/FIXME/XXX/TBD) in phase files | none found |

## Observable Truths
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Offline-recorded/edited meeting survives close/reopen | VERIFIED (code) | `src/lib/local/db.ts`, `repo.ts` (Dexie per-user DB, meetings + transcripts); `useRecorder.saveLocal` writes via `putParts` before any network; `LocalMeetingView` and `MeetingList` read from the device store. Runtime persistence is a human item. |
| 2 | On reconnect, meetings reach server without duplicates | VERIFIED (code) | `sync.ts` passes triggered by connectivity hint, visibility, App resume, timer; POST uses client id and server handles P2002 idempotently, returning `savedParts` (`api/meetings/route.ts`); pull uses `since` + `serverTime`. |
| 3 | Kill mid-sync / double sync never truncates or duplicates; minutes not overwritten | VERIFIED (code) | Tail push is `from`-indexed replace (idempotent), 409 returns `savedParts` and engine resumes from it; Web Locks `ifAvailable` serialises tabs; finish is only sent when no tail is dirty; `sync.ts` never sends `document`/`template` and the PATCH schema does not accept them; `cacheServerMeeting` keeps server document on pull. |
| 4 | Online recording (Deepgram and on-device) autosaves as before | VERIFIED (code) | `useRecorder` keeps `saveToServer` legacy path (`localModeRef` false when the local create fails) and keepalive tail on close; build and typecheck pass. Needs device test. |

## Key links
SyncProvider is mounted in Providers; `useRecorder` uses `putParts`/`flush`/`poke`/`markRecording`; `MeetingView` calls `flush` before AI minutes; `MeetingList` merges device rows; `meetings/[id]/page.tsx` falls back to `LocalMeetingView`. All WIRED.

## Requirements
OFF-03: satisfied at code level, pending the human items above.

## Gaps
None blocking. Note: the new `titleUpdatedAt` column must reach the production database; until then server routes use the legacy-column fallback (title last-writer-wins is degraded).
