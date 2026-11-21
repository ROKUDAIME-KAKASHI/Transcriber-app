# Phase 2: Local-First Meetings & Sync - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning (decisions auto-selected from research/ARCHITECTURE.md + SUMMARY.md)

<domain>
## Phase Boundary

Every meeting is stored on the device first (IndexedDB via Dexie) and reaches the server reliably through a sync engine, with client-generated IDs, idempotent create, a persisted `savedParts` cursor, and no duplicates or lost text. Also adds the server schema fields later phases need (speakerNames, engine, titleUpdatedAt) and the API endpoints (`/api/health`, `?since=` list, speakers relabel PATCH).

NOT in this phase: offline app shell / service worker / offline login (Phase 3), Offline indicator and feature gating UI (Phase 3; only a small "Saved on this device / Waiting for internet" save-state is here), diarization itself (Phase 4), redesign (Phase 5).

Requirement: OFF-03.
</domain>

<decisions>
## Implementation Decisions

### Local store
- **D-01:** Dexie 4 (`dexie`, plus `dexie-react-hooks` for liveQuery) in `src/lib/local/db.ts`; `src/lib/local/repo.ts` is the only code that touches IndexedDB. DB name namespaced by userId so accounts on one device never mix.
- **D-02:** `meetings` table keyed by `id` with: `id, userId, title, titleUpdatedAt, language, engine, deviceName, status, durationSec, createdAt, template, document, speakerNames, origin ("local"|"server"|"native"), parts (TranscriptPart[]), savedParts (server-confirmed cursor, persisted), serverUpdatedAt, dirty {tail, meta, speakers, finish}, deleted (tombstone), syncError`. Transcript parts are stored in the meeting record (a 10h meeting is ~1 MB); chunk only if the planner finds a measured need.
- **D-03:** Local write always succeeds first; the recorder never awaits the network. Request `navigator.storage.persist()` best-effort.

### IDs and create
- **D-04:** Meeting IDs are client-generated (`^[a-z0-9_-]{16,40}$`, crypto-random). `POST /api/meetings` accepts optional `id`, `createdAt`, `engine`; upsert scoped by userId. Same id + same user returns 200 `{meeting, savedParts}`; id owned by another user returns 409. Old clients (no id) keep working and get a cuid and 201.

### Sync protocol
- **D-05:** State-based sync, not an op log. Push order per meeting: create (idempotent), transcript tail (`transcriptTail {from: max(0, savedParts-1), parts}`, batches <= 2000 parts, 409 resets savedParts from server and retries), meta (title/titleUpdatedAt/speakerNames), finish (status DONE + durationSec). The existing `transcriptTail` + 409/`savedParts` protocol is reused unchanged.
- **D-06:** `savedParts` is persisted in Dexie so reload/kill mid-sync resumes without truncation or duplication; sending the same sync twice is a no-op (tail replace semantics are idempotent).
- **D-07:** Sync loop is a singleton guarded by Web Locks (`navigator.locks`, fallback in-tab mutex). Triggers: after a local write (`poke`), `online` event, visibility/app resume, timer (~5 s while recording, ~30 s otherwise), Capacitor `appStateChange` when available. Exponential backoff with a cap.
- **D-08:** Auth 401 pauses the queue (state `needs-auth`), never drops or clears data; resumes when a 2xx is seen or the user signs in. 5xx/503/network errors back off and retry. Sign-out must not delete unsynced local data.
- **D-09:** Reachability: new `GET /api/health` (204, `Cache-Control: no-store`, no DB hit). A minimal `src/lib/connectivity.ts` (probe + `navigator.onLine` hint, `@capacitor/network` if available) gates the sync loop only; full Offline UI/gating stays Phase 3.

### Field ownership / conflicts
- **D-10:** Transcript + duration + status belong to the recording device (single writer, append via tail). `document`/`template` belong to the server (AI); the device never pushes them and pull never lets a local value overwrite them. `title` is last-writer-wins by `titleUpdatedAt`. `speakerNames`/speaker labels: last PATCH wins. Pull replaces local `parts` only when the meeting is not locally dirty and not native-owned.
- **D-11:** Deletes: local tombstone (`deleted: true`) until `DELETE` succeeds (404 counts as success). Pull: a server id missing from `ids` is removed locally unless dirty, in which case it is re-created.
- **D-12:** AI minutes ("Generate") must not run on an unsynced meeting: before calling `/process` run `sync.flush(id)`; the resulting `document` is written into the local record.

### Server schema and API (additive, backward compatible)
- **D-13:** Prisma `Meeting` additions, all nullable/optional: `speakerNames Json?`, `engine String?`, `titleUpdatedAt DateTime?`. No existing column changes. Edit `prisma/schema.prisma` and run `npx prisma generate` only; do NOT run db push (the user runs `npx prisma db push` on their Neon DB). Document the deploy-order requirement (push schema before/with deploy).
- **D-14:** `PATCH /api/meetings/:id` additionally accepts `titleUpdatedAt` (apply `title` only when newer than stored), `speakerNames` (record of string->string, bounded), `engine`. New `PATCH /api/meetings/:id/speakers` relabel endpoint: body `{ relabel?: {from:number,to:number}[], parts?: {index:number, speaker:number}[], speakerNames? }` - relabels speaker numbers of existing parts and/or sets names (used by Phase 4); idempotent, scoped by userId.
- **D-15:** `GET /api/meetings?since=ISO` returns changed metadata plus the full `ids` list (so the client detects server-side deletions); without `since` behaviour is unchanged (plus `ids`). List select adds `engine`.
- **D-16:** `GET /api/meetings/:id` keeps returning the full meeting.

### Recorder integration (no regression)
- **D-17:** `useRecorder` (web + on-device): on start, generate the client id and write the local meeting before anything else; try the idempotent POST once if reachable, but never block or fail recording when it fails (on-device engines work offline; Deepgram needs the token fetch anyway). `save()` writes the tail to Dexie first, then calls the sync engine; `saveState` shows "Saved on this device" / "Synced" / "Waiting for internet". Final save on stop still retries as today. Online behaviour and autosave cadence stay as before.
- **D-18:** `useNativeRecorder` (Android foreground service): generates the client id, POSTs with it (online only; Deepgram), mirrors polled parts into Dexie as `origin:"native"`. RecordingService keeps autosaving to the server by itself; the JS sync engine does not push native-owned meetings' transcript (only mirrors them).
- **D-19:** UI: `MeetingList` merges Dexie meetings with server-provided ones (liveQuery), showing a small "Not synced yet" badge for dirty ones; the meeting page falls back to a client loader that reads the meeting from Dexie when the server has no row for a not-yet-synced id. Edits (rename, delete) go local-first then sync. Do not build the offline app shell here.

### Claude's Discretion
Exact table layout/indexes, chunking of parts, backoff constants, file names beyond those above, badge wording, and test strategy (pure-logic tests acceptable if any dependency is small; otherwise typecheck + build + manual-test checklist).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/ARCHITECTURE.md` sections 3-5, 7 - layout, data model, sync push/pull, field ownership
- `.planning/research/SUMMARY.md` - phase decisions
- `.planning/research/PITFALLS.md` - data-loss pitfalls (sync, signing out)
- `.planning/research/STACK.md` - Dexie 4.4.7, dexie-react-hooks 4.4.0
- `.planning/REQUIREMENTS.md` (OFF-03), `.planning/ROADMAP.md` (Phase 2 success criteria)
- `src/app/api/meetings/route.ts`, `src/app/api/meetings/[id]/route.ts`, `prisma/schema.prisma` - current server contract
- `src/hooks/useRecorder.ts` (save(), savedPartsRef, start()), `src/hooks/useNativeRecorder.ts` - current recording/save flow
- `.planning/phases/01-export-share-navigation/01-CONTEXT.md` - prior decisions (native.ts capability layer)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useRecorder.save()` already implements tail-append + 409 resync; move that logic into the sync engine rather than rewriting.
- `src/lib/native.ts` capability layer from Phase 1 (`@capacitor/network`, `@capacitor/app` already installed).
- `src/lib/transcript.ts` (TranscriptPart, parseTranscript, detectDeviceName).

### Established Patterns
- API routes: zod validation, `getUserId()/unauthorized()`, `dbDown` 503, updateMany scoped by userId.
- Meetings list and page are server components with `force-dynamic` + prisma; MeetingView/MeetingList are client components fed props.

### Integration Points
- useRecorder start()/save()/stop(); useNativeRecorder start()/apply(); MeetingList; MeetingView (rename, delete, generate); meetings pages.
</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the research documents.
</specifics>

<deferred>
## Deferred Ideas

- Offline app shell, service worker, offline sign-in, Offline indicator, feature gating UI - Phase 3
- Speaker embeddings/diarization and rename UI - Phase 4 (server fields and relabel endpoint prepared here)
- Static `/meeting?id=` route - Phase 3
</deferred>

---

*Phase: 2-Local-First Meetings & Sync*
*Context gathered: 2026-11-21*
