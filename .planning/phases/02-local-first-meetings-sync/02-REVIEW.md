---
phase: 02-local-first-meetings-sync
reviewed: 2026-11-21T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - README.md
  - package.json
  - prisma/schema.prisma
  - src/app/api/health/route.ts
  - src/app/api/meetings/[id]/process/route.ts
  - src/app/api/meetings/[id]/route.ts
  - src/app/api/meetings/[id]/speakers/route.ts
  - src/app/api/meetings/route.ts
  - src/app/meetings/[id]/page.tsx
  - src/components/LocalMeetingView.tsx
  - src/components/MeetingList.tsx
  - src/components/MeetingView.tsx
  - src/components/Providers.tsx
  - src/components/Recorder.tsx
  - src/components/SyncProvider.tsx
  - src/hooks/useNativeRecorder.ts
  - src/hooks/useRecorder.ts
  - src/hooks/useSync.ts
  - src/lib/connectivity.ts
  - src/lib/local/db.ts
  - src/lib/local/ids.ts
  - src/lib/local/repo.ts
  - src/lib/local/sync.ts
  - src/lib/local/syncCore.ts
  - src/lib/local/types.ts
  - src/lib/meetingSelect.ts
  - tests/syncCore.test.ts
findings:
  critical: 1
  warning: 8
  info: 3
  total: 12
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-11-21
**Depth:** standard (cross-file on the sync engine)
**Files Reviewed:** 27
**Status:** issues_found

## Summary

The sync core is carefully designed: userId scoping is present on every Prisma query, the tail
protocol self-heals through 409 + savedParts, tail-clear is guarded by `localRev`, a 401 keeps the
data and parks the engine in `needs-auth`, and Dexie access is wrapped so SSR cannot throw.
The defects are concentrated in rows with `origin === "native"` (every APK recording), in the
pull-side refetch bookkeeping, and in several cases where one bad meeting or a stale writer can
stall or truncate data.

## Critical Issues

### CR-01: Renames (and speaker names) on native-origin meetings never sync and block AI minutes

**File:** `src/lib/local/sync.ts:166` (consumers: `src/components/MeetingView.tsx` saveTitle / processing flush, `src/lib/local/syncCore.ts:118`)
**Issue:** `syncMeeting` returns `"next"` for `m.origin === "native"` before the `dirty.meta`,
`dirty.speakers` steps (only tail/finish are meant to be skipped per D-18). Every meeting recorded
in the Android app has origin `native`. `MeetingView.saveTitle` calls `setLocalTitle` (succeeds,
sets `dirty.meta`, `pending=1`) then `poke`; the engine never PATCHes the title. Consequences:
1. The rename never reaches the server or other devices; on pull, local `titleUpdatedAt` is newer so
   the local title is kept and `dirty.meta` stays true forever.
2. The list shows "Not synced yet" permanently.
3. "Generate minutes" calls `flush(id)`, which only returns `synced` when `pending === 0`; for a
   renamed native meeting it times out and the user gets "Waiting to upload the transcript"
   even while online, so minutes cannot be generated for that meeting at all.
**Fix:** Skip only the tail and finish steps for native rows, not meta/speakers:
```ts
const native = m.origin === "native";
let cur = (await repo.getMeta(uid, id)) ?? m;
if (!native && cur.dirty.tail) { /* tail loop */ }
if (cur.dirty.meta) { /* ... */ }
if (cur.dirty.speakers) { /* ... */ }
if (!native && cur.dirty.finish) { /* ... */ }
```
Add a syncCore/engine test: a native row with only `dirty.meta` ends with `pending === 0`.

## Warnings

### WR-01: Pull refetch is capped at 5 and never retried; stale local transcripts persist

**File:** `src/lib/local/sync.ts:263-275`, `src/lib/local/syncCore.ts:124-128`
**Issue:** `mergePulledMeeting` deliberately keeps the old `serverUpdatedAt` "so a failed refetch is
retried on the next pull", but the next pull uses `?since=<lastPullAt>`, and `lastPullAt` is advanced
to `serverTime - 5s` at the end of every successful pull regardless. A meeting whose refetch was
beyond `slice(0, 5)`, or whose GET failed (non-auth), is no longer returned by the server's
`updatedAt > since` filter, so its cached transcript (e.g. after a speaker relabel on another device)
is never refreshed. The user keeps seeing and exporting the stale local copy.
**Fix:** Persist unfinished refetches, e.g. `kvSet(uid, "refetch", ids)`, and drain that list at the
start of each pull; or only advance `lastPullAt` when every refetch succeeded; or derive the refetch
set from local rows where `serverUpdatedAt` is older than the last server value seen.

### WR-02: Stale keepalive PATCH on pagehide can truncate the server transcript, then be cached back

**File:** `src/hooks/useRecorder.ts:259-271, 279`
**Issue:** `sendKeepaliveTail` fires a fire-and-forget tail PATCH built from `savedPartsRef` (a
possibly stale value) while the sync engine may be mid-upload of a longer tail. The server replaces
everything from `from` onwards, so whichever lands last wins; if the older/shorter body lands last,
the server transcript is shorter than local. If the local tail flag was already cleared the engine
sends nothing more, and a later pull sees a newer `updatedAt`, refetches and `cacheServerMeeting`
overwrites the fuller local copy with the truncated server copy (data loss).
**Fix:** Drop the keepalive tail in local mode (the data is already in IndexedDB and the engine will
upload it next session), or make the server tail PATCH reject a shorter `from + parts.length` than the
stored length when it carries no `status` (compare-and-swap on a `baseCount`).

### WR-03: Read-modify-write of `transcript` is not atomic (lost updates)

**File:** `src/app/api/meetings/[id]/route.ts:80-89`, `src/app/api/meetings/[id]/speakers/route.ts:36-58`
**Issue:** Both handlers read the transcript JSON, compute a new array and write it back with no
transaction or version check. A speaker relabel (or a second device's tail PATCH) interleaving with
an autosave silently drops the other writer's parts or labels. The 409 self-heal does not detect this
because the stale writer's `from` is still <= the length.
**Fix:** Wrap in `prisma.$transaction` with `SELECT ... FOR UPDATE` (via `$queryRaw`), or add an
optimistic version column (`WHERE id AND userId AND updatedAt = <read value>`) and retry on count 0.

### WR-04: Poison or rejected meeting blocks or hammers the whole sync

**File:** `src/lib/local/sync.ts:109-126, 288-292`; `src/components/MeetingView.tsx` (title input has no maxLength)
**Issue:** (a) Any 5xx or network error for one meeting returns `"stop"` for the entire pass with
global exponential backoff, so one meeting that persistently 500s starves every other meeting.
(b) A 400/422 (e.g. title longer than the server's 200 cap, which the local input permits, or empty
after trim) sets `syncError = "rejected"` and moves on, but `listPending` still returns it and only
`"conflict"` is skipped, so it is re-sent every 5-30 s forever. Because meta is processed before
finish, a rejected title also prevents `PATCH status: DONE`, leaving the meeting `RECORDING` on the server.
**Fix:** Skip rows with any `syncError` after N attempts or park them with a per-row `nextAttemptAt`;
continue to the next meeting on per-meeting 5xx; validate title length (trim, 1-200) in
`repo.setTitle`; run `finish` even if `meta` was rejected.

### WR-05: recoverOrphans in a second tab can mark an active recording DONE

**File:** `src/lib/local/repo.ts:353-382`, `src/components/SyncProvider.tsx:52`
**Issue:** The guard that protects another tab's live recording is `lastWriteAt` within 30 s, but
`putParts` is only called when new text arrived (`dirtyRef`). A pause or silence longer than 30 s is
normal in meetings; a new tab, a reload of another page, or the Capacitor WebView re-creating the
page then flips the running row to `DONE` with `finish`, which uploads `status: DONE` while the first
tab keeps recording. `isActive` only sees the current tab's set.
**Fix:** Heartbeat: touch `lastWriteAt` every few seconds from the recorder while recording (even
without new parts), and use a larger window (>= 2 min); optionally keep an `activeRecording` kv key.

### WR-06: Sign-out leaves the previous user's data readable and the engine running

**File:** `src/components/SyncProvider.tsx:14, 45-46`
**Issue:** `userId = sessionUserId ?? lastUserId` and `LAST_USER_KEY` is never cleared, so after
sign-out the engine keeps running as the last user (401 loop at 60 s) and the per-user IndexedDB with
full transcripts remains on a shared browser/device. Anything that reads `useLocalUser()` after
sign-out (record screen, list) can still operate on that DB.
**Fix:** On `status === "unauthenticated"` after a prior authenticated session (explicit signOut),
remove `LAST_USER_KEY` and (after confirming no unsynced rows, else warn) delete the Dexie DB
(`Dexie.delete("transcriber-" + uid)`); keep the fallback only for failed session fetches
(status `loading` / network error).

### WR-07: Unpushed schema silently drops engine/speakerNames but reports success

**File:** `src/app/api/meetings/[id]/route.ts:75, 113`; `src/app/api/meetings/[id]/speakers/route.ts:50-64`
**Issue:** Under `legacy` the PATCH ignores `engine`/`speakerNames` yet returns `{ok: true}`, so the
client clears `dirty.speakers` and the names are lost permanently; the speakers route does the same via
`write(false)`. Offline-first clients treat 2xx as "durably stored".
**Fix:** In legacy mode return 503 (retryable) when the request carries `speakerNames` (or `engine`
only if it is the sole change), so the client keeps the dirty flag until the schema is pushed.

### WR-08: Native mirror rewrites the whole transcript 4x/second after the recording finishes

**File:** `src/hooks/useNativeRecorder.ts:74`
**Issue:** The condition `n.finished || Date.now() - lastMirrorRef.current > MIRROR_MS` is true on
every 250 ms poll while the finished state remains displayed, so `mirrorNative` rewrites the entire
transcript row (and re-triggers every `useLiveQuery`) continuously until the user leaves the screen;
it also races with `cacheServerMeeting`/pull writes to the same row, and a native meeting with a
pending rename gets repeated overwrites of `partsCount`/`status`.
**Fix:** Track `lastMirroredFinished` in a ref and mirror once on the transition to finished:
```ts
if (n.finished ? !mirroredFinalRef.current : Date.now() - lastMirrorRef.current > MIRROR_MS) { ...; if (n.finished) mirroredFinalRef.current = true; }
```
Reset the ref in `start`.

## Info

### IN-01: Existence of another account's meeting id is distinguishable (409 vs 201)

**File:** `src/app/api/meetings/route.ts:96-104`
**Issue:** POST with a chosen `id` returns 409 "Id in use" if it exists under another user, versus
201/200 otherwise. With UUID/cuid ids this is not practically exploitable, but it is an id oracle, and
the client reacts by parking the meeting as `syncError: "conflict"` forever with no recovery.
**Fix:** Optionally return 404/201-equivalent opaque responses; on the client, regenerate the id of a
never-synced local meeting on 409 instead of stranding it.

### IN-02: Dead / divergent code

**File:** `src/lib/local/repo.ts:162` (`setSpeakerNames` unused by any component), `src/lib/local/sync.ts:342-343` (`poke(id)` ignores `id`), `src/lib/local/ids.ts:11-13` (`isValidMeetingId` duplicates `MEETING_ID_RE` regex and is never the single source)
**Issue:** Unused exports and a duplicated regex that can drift from `MEETING_ID_RE`.
**Fix:** Remove or import the constant from `meetingSelect.ts`; wire `setSpeakerNames` or delete it.

### IN-03: Stale server props can overwrite a newer device copy on page mount

**File:** `src/components/MeetingView.tsx:89-93`, `src/lib/local/repo.ts:189-235`
**Issue:** `cacheServerMeeting` with `pending === 0` unconditionally replaces title/transcript with the
SSR props (possibly from the client router cache) and sets `serverUpdatedAt` to that older
`updatedAt`; a just-synced rename can be visually reverted until the next pull corrects it. Also
`pull` -> `fail(uid, "", ...)` passes an empty id and for 409/404-class pull replies would call
`applySyncResult(uid, "", ...)` (no-op).
**Fix:** In `cacheServerMeeting`, skip when `existing && ts(existing.serverUpdatedAt) > ts(m.updatedAt)`;
treat non-ok pull classes other than auth/retry as `retry` before calling `fail`.

---

_Reviewed: 2026-11-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
