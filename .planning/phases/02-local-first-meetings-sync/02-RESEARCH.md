# Phase 2: Local-First Meetings & Sync - Research

**Researched:** 2026-11-21
**Domain:** IndexedDB (Dexie 4) local-first store + state-based sync to a Next.js 16 / Prisma 6 / Neon API, wrapped around an existing recorder that must not regress
**Confidence:** HIGH for the code contracts (read from the repo), MEDIUM-HIGH for the Dexie/Prisma behaviour, MEDIUM for performance numbers (not measured on a phone)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Local store
- **D-01:** Dexie 4 (`dexie`, plus `dexie-react-hooks` for liveQuery) in `src/lib/local/db.ts`; `src/lib/local/repo.ts` is the only code that touches IndexedDB. DB name namespaced by userId so accounts on one device never mix.
- **D-02:** `meetings` table keyed by `id` with: `id, userId, title, titleUpdatedAt, language, engine, deviceName, status, durationSec, createdAt, template, document, speakerNames, origin ("local"|"server"|"native"), parts (TranscriptPart[]), savedParts (server-confirmed cursor, persisted), serverUpdatedAt, dirty {tail, meta, speakers, finish}, deleted (tombstone), syncError`. Transcript parts are stored in the meeting record (a 10h meeting is ~1 MB); chunk only if the planner finds a measured need.
- **D-03:** Local write always succeeds first; the recorder never awaits the network. Request `navigator.storage.persist()` best-effort.

#### IDs and create
- **D-04:** Meeting IDs are client-generated (`^[a-z0-9_-]{16,40}$`, crypto-random). `POST /api/meetings` accepts optional `id`, `createdAt`, `engine`; upsert scoped by userId. Same id + same user returns 200 `{meeting, savedParts}`; id owned by another user returns 409. Old clients (no id) keep working and get a cuid and 201.

#### Sync protocol
- **D-05:** State-based sync, not an op log. Push order per meeting: create (idempotent), transcript tail (`transcriptTail {from: max(0, savedParts-1), parts}`, batches <= 2000 parts, 409 resets savedParts from server and retries), meta (title/titleUpdatedAt/speakerNames), finish (status DONE + durationSec). The existing `transcriptTail` + 409/`savedParts` protocol is reused unchanged.
- **D-06:** `savedParts` is persisted in Dexie so reload/kill mid-sync resumes without truncation or duplication; sending the same sync twice is a no-op (tail replace semantics are idempotent).
- **D-07:** Sync loop is a singleton guarded by Web Locks (`navigator.locks`, fallback in-tab mutex). Triggers: after a local write (`poke`), `online` event, visibility/app resume, timer (~5 s while recording, ~30 s otherwise), Capacitor `appStateChange` when available. Exponential backoff with a cap.
- **D-08:** Auth 401 pauses the queue (state `needs-auth`), never drops or clears data; resumes when a 2xx is seen or the user signs in. 5xx/503/network errors back off and retry. Sign-out must not delete unsynced local data.
- **D-09:** Reachability: new `GET /api/health` (204, `Cache-Control: no-store`, no DB hit). A minimal `src/lib/connectivity.ts` (probe + `navigator.onLine` hint, `@capacitor/network` if available) gates the sync loop only; full Offline UI/gating stays Phase 3.

#### Field ownership / conflicts
- **D-10:** Transcript + duration + status belong to the recording device (single writer, append via tail). `document`/`template` belong to the server (AI); the device never pushes them and pull never lets a local value overwrite them. `title` is last-writer-wins by `titleUpdatedAt`. `speakerNames`/speaker labels: last PATCH wins. Pull replaces local `parts` only when the meeting is not locally dirty and not native-owned.
- **D-11:** Deletes: local tombstone (`deleted: true`) until `DELETE` succeeds (404 counts as success). Pull: a server id missing from `ids` is removed locally unless dirty, in which case it is re-created.
- **D-12:** AI minutes ("Generate") must not run on an unsynced meeting: before calling `/process` run `sync.flush(id)`; the resulting `document` is written into the local record.

#### Server schema and API (additive, backward compatible)
- **D-13:** Prisma `Meeting` additions, all nullable/optional: `speakerNames Json?`, `engine String?`, `titleUpdatedAt DateTime?`. No existing column changes. Edit `prisma/schema.prisma` and run `npx prisma generate` only; do NOT run db push (the user runs `npx prisma db push` on their Neon DB). Document the deploy-order requirement (push schema before/with deploy).
- **D-14:** `PATCH /api/meetings/:id` additionally accepts `titleUpdatedAt` (apply `title` only when newer than stored), `speakerNames` (record of string->string, bounded), `engine`. New `PATCH /api/meetings/:id/speakers` relabel endpoint: body `{ relabel?: {from:number,to:number}[], parts?: {index:number, speaker:number}[], speakerNames? }` - relabels speaker numbers of existing parts and/or sets names (used by Phase 4); idempotent, scoped by userId.
- **D-15:** `GET /api/meetings?since=ISO` returns changed metadata plus the full `ids` list (so the client detects server-side deletions); without `since` behaviour is unchanged (plus `ids`). List select adds `engine`.
- **D-16:** `GET /api/meetings/:id` keeps returning the full meeting.

#### Recorder integration (no regression)
- **D-17:** `useRecorder` (web + on-device): on start, generate the client id and write the local meeting before anything else; try the idempotent POST once if reachable, but never block or fail recording when it fails (on-device engines work offline; Deepgram needs the token fetch anyway). `save()` writes the tail to Dexie first, then calls the sync engine; `saveState` shows "Saved on this device" / "Synced" / "Waiting for internet". Final save on stop still retries as today. Online behaviour and autosave cadence stay as before.
- **D-18:** `useNativeRecorder` (Android foreground service): generates the client id, POSTs with it (online only; Deepgram), mirrors polled parts into Dexie as `origin:"native"`. RecordingService keeps autosaving to the server by itself; the JS sync engine does not push native-owned meetings' transcript (only mirrors them).
- **D-19:** UI: `MeetingList` merges Dexie meetings with server-provided ones (liveQuery), showing a small "Not synced yet" badge for dirty ones; the meeting page falls back to a client loader that reads the meeting from Dexie when the server has no row for a not-yet-synced id. Edits (rename, delete) go local-first then sync. Do not build the offline app shell here.

### Claude's Discretion
Exact table layout/indexes, chunking of parts, backoff constants, file names beyond those above, badge wording, and test strategy (pure-logic tests acceptable if any dependency is small; otherwise typecheck + build + manual-test checklist).

### Deferred Ideas (OUT OF SCOPE)
- Offline app shell, service worker, offline sign-in, Offline indicator, feature gating UI - Phase 3
- Speaker embeddings/diarization and rename UI - Phase 4 (server fields and relabel endpoint prepared here)
- Static `/meeting?id=` route - Phase 3
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OFF-03 | Meetings recorded or edited offline are stored on the device and sync to the server automatically when internet returns, without duplicates or lost text | Client ids + idempotent POST (dedupe); persisted `savedParts` + existing tail/409 protocol (no lost/duplicated text); Dexie store + sync engine with online/resume/timer triggers (automatic); field ownership so `/process` output is never overwritten; native-recorder contract kept intact (no regression). See "Architecture Patterns", "Common Pitfalls", "Recommended Task Decomposition". |
</phase_requirements>

## Project Constraints (from CLAUDE.md and the orchestrator)

- Keep Next.js 16 App Router + Tailwind v4 + Capacitor 8. No rewrite.
- Never print `.env` or keystore secrets. Keys stay server-side.
- No Vercel deploys, no `git push`, no public tunnels.
- **Do NOT run `prisma db push`.** Edit `prisma/schema.prisma` and run `npx prisma generate` only.
- Server changes must be additive and backward compatible: already-installed APKs and the RecordingService keep calling the old contract.
- Online behaviour of `useRecorder` and the Android `RecordingService` autosave must not regress.
- C: drive nearly full: no big downloads, no emulator, no adb.
- Must keep working as a plain website and inside the Android app.
- GSD workflow: edits only through GSD execution.
- Executors run on Sonnet; keep tasks concrete.

## Summary

The current save path is already a resumable cursor protocol: `useRecorder.save()` (and an identical Java copy in `RecordingService.save()`) sends `transcriptTail {from: max(0, savedParts-1), parts}`, the server replaces from `from` onward, and returns 409 with `savedParts` when the client is ahead. What's missing for OFF-03 is: (1) the meeting id comes from the server, so recording cannot start without a successful `POST /api/meetings` (`useRecorder.start()` line ~844 throws on failure), (2) `savedPartsRef` and the transcript live only in memory, so a reload or kill loses everything not yet PATCHed, (3) there is no retry after the recorder unmounts. The phase adds a Dexie store as the source of truth, moves the network half of `save()` into a singleton sync engine that reads from Dexie, and makes create idempotent with client ids. The server tail protocol does not change.

Two contracts must not move. The Android `RecordingService` PATCHes `/api/meetings/{id}` with a cookie from the WebView store and treats any non-2xx other than 409 as a failure that it retries every 5 s. It never creates the meeting, so **a server row must exist before `MeetingRecorder.start()` is called** (a 404 would make it show "error" for the whole meeting). Old APKs also call `POST /api/meetings` without an `id`, which must still return 201 with a cuid. Everything else on the server is additive.

The largest deploy risk is not the code but the schema: as soon as `prisma generate` runs with the three new fields, every Prisma query that returns *all* scalar fields (`findFirst({ where })` with no `select`, used by the meeting page, `GET /api/meetings/:id` and `/process`) will name the new columns in SQL and fail until the user has run `npx prisma db push` on Neon. Pushing first is safe (old code ignores extra nullable columns), so the plan needs a blocking human checkpoint "push schema before deploy" plus explicit `select` lists.

**Primary recommendation:** Build it as five plans: server contract (W1) and local store + pure sync logic with `node:test` tests (W1, parallel), then the sync engine + provider (W2), then recorder integration and UI integration (W3, parallel). Keep transcript writes to Dexie on the existing 5 s autosave tick, not per phrase, and keep the full transcript in a separate Dexie table so lists don't load megabytes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Meeting persistence while recording | Browser (IndexedDB via Dexie) | API (Postgres) | Must work with no network. Server is the shared copy. |
| Client id generation | Browser | API validates format | Dedupe needs the id before the first request. |
| Idempotent create / ownership check | API (`POST /api/meetings`) | DB unique PK | Only the server can see other users' ids (409). |
| Transcript tail merge | API (`PATCH /api/meetings/:id`) | Browser sync engine | Unchanged protocol. Server is the merge point for native + web clients. |
| Title LWW | API (conditional `updateMany`) | Browser sends `titleUpdatedAt` | Atomic compare at the DB avoids read-modify-write races. |
| Sync scheduling, backoff, needs-auth | Browser (singleton under Web Lock) | — | Background Sync is unavailable in Android WebView, so sync runs in the page. |
| Reachability probe | API (`/api/health`, no DB) | Browser (`connectivity.ts`) | `navigator.onLine` lies. Probe must not wake Neon. |
| Native (Deepgram, screen-off) autosave | Android `RecordingService` | Browser mirrors into Dexie | Unchanged. JS never pushes native transcripts. |
| AI minutes | API (`/process`) | Browser flushes sync first | Server owns `document`/`template`. |
| Meetings list / meeting page | Frontend server (SSR, prisma) | Browser merges Dexie | Phase 2 keeps SSR. Static shells are Phase 3. |

## Current Code Contracts (verified by reading the repo)

### `src/hooks/useRecorder.ts` (917 lines)
- `save(status?: "DONE", closing = false)` (L200-248): no-op when `!meetingIdRef.current` or not dirty. One save in flight (`savingRef`); autosave skips while one runs, final/closing waits. Computes `from = max(0, min(savedPartsRef-1, parts.length))`, PATCHes `{transcriptTail, durationSec, status?}`, `keepalive` only when `closing && body < 60 000`. On 409 with `savedParts` it resets the cursor and loops once more (2 attempts). On success `savedPartsRef = data.savedParts ?? parts.length`, `saveState: "saved"`. On failure `dirtyRef = true`, `saveState: "error"`.
- Parts mutate only at the end: `appendFinal` (L257) appends, `appendDeepgram` (L397-415) can replace the **last** part (growing bubble). All updates are immutable array copies, so they can be put into IndexedDB without extra cloning.
- `start()` (L734-900): resets refs, creates the AudioContext before any await (iOS), gets the mic, loads the on-device model, **then** `POST /api/meetings` (L844) and **throws** if it fails or returns 401 ("You've been signed out"). Only after that does it set `meetingIdRef`, start the engine, start `timerRef` and `autosaveRef = setInterval(save, 5000)`.
- `stop()` (L660-698): flushes the chunker, closes Deepgram, waits for pending segments, then retries `save("DONE")` up to 4 times with 2/4/6 s waits. Message "Saved to your account." or "Couldn't save the last part…".
- `pagehide` → `save(undefined, true)` (L903-907). Unmount → `stop()` or `cancelStart()`.
- `RecorderState.saveState: "idle" | "saving" | "saved" | "error"`. `Recorder.tsx` shows the meeting link only when `saveState === "saved"` (L166) and renders Saving / Saved / "Offline · will retry" (L175-179).

### `src/hooks/useNativeRecorder.ts` + `src/lib/nativeRecorder.ts`
- `start()` POSTs `/api/meetings` first (must succeed), then `MeetingRecorder.start({meetingId, language, baseUrl: window.location.origin})`.
- Polls `MeetingRecorder.getState({from})` every 250 ms **only while visible**, merging into `partsRef`. `n.saveState` comes from the service. So a Dexie mirror is only as complete as what the page saw.
- Native mode is used when in the app and `engine === "deepgram"` (Recorder.tsx L118).

### Android `RecordingService.save()` (L665-720)
- Same tail protocol in Java. `PATCH /api/meetings/{currentMeetingId}` with `Cookie` from `CookieManager.getCookie(baseUrl)`.
- 409 with `savedParts` → reset and retry. Any other non-2xx (including **404**) → `saveState = "error"`, `dirty = true`, retried on the next 5 s tick.
- Finish: up to 5 `save("DONE")` attempts with exponential sleeps, then `shutdown()`. After that the service never writes again. On `onDestroy` while running, it stops without a final save.
- Consequence: the server row must exist before the service starts (keep the awaited POST for native). The service never sends `id`, `titleUpdatedAt` or new fields, so all new PATCH fields must stay optional.

### Server
- `POST /api/meetings`: zod `{title?, language default "en", deviceName?}`, `prisma.meeting.create`, 201 `{meeting:{id,title}}`.
- `PATCH /api/meetings/:id`: tail path does `findFirst` → slice/merge → `updateMany` (read-modify-write, no transaction). `MAX_PARTS = 60 000`, part text ≤ 5000 chars. Non-tail path is `updateMany({where:{id,userId}, data})`.
- `GET /api/meetings/:id`, `src/app/meetings/[id]/page.tsx` and `/process` all use `findFirst({ where: { id, userId } })` with **no `select`** (they return every column).
- List route and list page use explicit `select`.
- `Meeting.id` is `String @id @default(cuid())`. A client-supplied id needs no schema change (Prisma only applies the default when `id` is omitted). [VERIFIED: prisma/schema.prisma]
- Auth: next-auth v4 JWT, `getUserId()` from `getServerSession`. Client has `useSession().data.user.id` (typed in `types/next-auth.d.ts`).
- `public/sw.js` only handles navigations (offline.html fallback) and never touches `/api/*`. Nothing to change in Phase 2.

### Tooling
- **No test runner** in `package.json` (scripts: dev, build, start, typecheck, db:push, postinstall). Node is **v24.19.0**. [VERIFIED: `node --version`]
- I verified that `node --test file.test.ts` runs TypeScript natively on this machine (type stripping), including a file with a type-only `@/` alias import. [VERIFIED: ran it in the scratchpad] Runtime imports must be relative with an explicit `.ts` extension, and `@/` aliases do not resolve at runtime.

## Standard Stack

### Core (new)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dexie` | 4.4.7 (modified 2026-10-23) | IndexedDB schema, versioned migrations, transactions, `liveQuery` | Locked (D-01). Works the same in Android WebView and desktop browsers. [VERIFIED: npm registry, repo github.com/dexie/Dexie.js] |
| `dexie-react-hooks` | 4.4.0 | `useLiveQuery` for MeetingList / local meeting page | Locked (D-01). Peer `dexie >=4.2.0-alpha.1 <5`, `react >=16`. [VERIFIED: npm registry] |

### Already installed (reuse)
| Library | Version | Use in this phase |
|---------|---------|-------------------|
| `@capacitor/network` | 8.0.1 | Connectivity hint in the app (`getStatus`, `networkStatusChange`) via `getNetwork()` in `src/lib/native.ts` |
| `@capacitor/app` | 8.1.2 | `appStateChange` / `resume` sync trigger via `getApp()` |
| `zod` | ^4.4.3 | New request bodies |
| `@prisma/client` / `prisma` | ^6.19.3 | Additive fields |

### Supporting (optional, dev only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fake-indexeddb` | 6.2.8 | IndexedDB in Node tests | Only if the planner wants repo-level tests. It also needs a TS loader such as `tsx` 4.23.15 because `repo.ts` imports siblings without `.ts` extensions. **Recommendation: skip it in this phase** and test the pure sync core with `node:test` (zero dependencies). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:test` with native TS | `vitest` 5.1.1 | Pulls in vite (tens of MB) on a nearly full C: drive. Not needed for pure functions. |
| Dexie `liveQuery` | Manual `BroadcastChannel` + state | Hand-rolled change notifications. Dexie already handles cross-tab notifications. |

**Installation:**
```bash
npm install dexie@4.4.7 dexie-react-hooks@4.4.0
```

## Package Legitimacy Audit

slopcheck could not be run: installing it was denied by the environment's permission classifier. Following the protocol, packages are tagged `[ASSUMED]` for legitimacy and the planner should gate the install behind a `checkpoint:human-verify`, or the user approves it in the plan. The registry facts below were checked with `npm view`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| dexie | npm | 12 yrs (created 2014-08-21) | not checked | github.com/dexie/Dexie.js | not run | Approved [ASSUMED]: long-lived, already named in the project's STACK.md research |
| dexie-react-hooks | npm | 6 yrs (2020-11-19) | not checked | github.com/dexie/Dexie.js (same monorepo) | not run | Approved [ASSUMED] |
| fake-indexeddb (optional) | npm | 11 yrs (2015-05-09) | not checked | github.com/dumbmatter/fakeIndexedDB | not run | Optional, not recommended this phase |

No `postinstall` scripts were reported by `npm view … scripts.postinstall` for dexie or dexie-react-hooks (empty output). [VERIFIED: npm registry]

**Packages removed:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
 Recorder (web/on-device)            Recorder (Android native, Deepgram)
   start: id=newId()                   start: id=newId()
   repo.createLocal(id) ──┐            repo.createLocal(id, origin:"native")
   sync.poke(id)          │            await POST /api/meetings {id,...}  (must succeed)
   every 5 s / hidden /   │            MeetingRecorder.start({meetingId:id})
   stop: repo.putParts ───┤            poll getState ─► repo.mirrorNative(id, parts) (throttled)
   stop: repo.finish(id) ─┤                     │
                          ▼                     ▼
              ┌──────────────────────────────────────────┐
              │ IndexedDB  transcriber-<userId>           │◄── useLiveQuery: MeetingList,
              │  meetings (metadata + dirty + savedParts) │    LocalMeetingView, save badge
              │  transcripts (id -> parts[])              │
              │  kv (lastPullAt, ...)                     │
              └──────────────────────┬───────────────────┘
                                     │ read dirty / tombstoned
                         poke/online/resume/timer
                                     ▼
              ┌──────────────────────────────────────────┐
              │ syncEngine (one per origin: navigator.locks)
              │  reachable? (connectivity.ts → /api/health)
              │  per meeting, oldest first, skip origin:"native" tails:
              │   1 create  POST /api/meetings {id,...}  200/201 ok, 409 → syncError
              │   2 tail    PATCH {transcriptTail}  batches, 409 → savedParts=server → retry
              │   3 meta    PATCH {title,titleUpdatedAt,speakerNames}
              │   4 finish  PATCH {status:"DONE",durationSec}
              │   5 delete  DELETE (404 = ok) → purge local
              │  401 → state needs-auth (pause, keep data)
              │  5xx/network → backoff (cap)
              │  pull: GET /api/meetings?since → upsert metadata, ids → deletions
              └──────────────────────┬───────────────────┘
                                     ▼
              Next.js API (Vercel) ── Prisma ── Neon Postgres
                    ▲
                    └── RecordingService PATCHes tail itself (unchanged)
```

### Recommended file layout
```
src/lib/local/
├── ids.ts          # newMeetingId(): crypto.randomUUID() or getRandomValues fallback; isValidId()
├── db.ts           # Dexie subclass, schema v1, getLocalDb(userId) (lazy, browser only)
├── repo.ts         # ONLY IndexedDB access: createLocal, putParts, setTitle, tombstone, finish,
│                   # mirrorNative, cacheServerMeeting, upsertFromPull, listMeetings, getMeeting
├── syncCore.ts     # PURE functions, no runtime imports: nextTailBatch, applyTailResponse,
│                   # mergePulledMeeting (field ownership), backoffDelay, classifyResponse
└── sync.ts         # engine: lock, triggers, loop, flush(id), status store (useSyncExternalStore)
src/lib/connectivity.ts   # isReachable(): navigator.onLine hint + /api/health probe (3-5 s timeout)
src/components/SyncProvider.tsx  # in Providers: binds session userId → db + engine; lastUser in localStorage
src/components/LocalMeetingView.tsx  # client loader used by /meetings/[id] when server has no row
src/app/api/health/route.ts
src/app/api/meetings/[id]/speakers/route.ts
src/lib/meetingSelect.ts   # explicit Prisma select objects (legacy + full)
tests/syncCore.test.ts     # node:test, excluded from tsconfig
```

### Pattern 1: Lazy, user-namespaced Dexie instance (SSR-safe)
`dexie-react-hooks` `useLiveQuery` skips its synchronous first read when `typeof window === 'undefined'` and subscribes in `useEffect`, so during SSR it just returns `defaultResult`. [VERIFIED: dexie-react-hooks 4.4.0 dist source via unpkg] Client components are still rendered on the server, so never open the DB at module scope. Create it lazily from a getter that is only called inside queriers and effects.

```ts
// src/lib/local/db.ts
import Dexie, { type EntityTable } from "dexie";
import type { LocalMeeting, LocalTranscript, KvRow } from "./types";

export class LocalDb extends Dexie {
  meetings!: EntityTable<LocalMeeting, "id">;
  transcripts!: EntityTable<LocalTranscript, "id">;
  kv!: EntityTable<KvRow, "key">;
  constructor(userId: string) {
    super(`transcriber-${userId}`);
    this.version(1).stores({
      // only indexed fields are listed; everything else is still stored
      meetings: "id, createdAt, status, origin, deleted, pending",
      transcripts: "id",
      kv: "key",
    });
  }
}
const cache = new Map<string, LocalDb>();
export function getLocalDb(userId: string): LocalDb {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  let db = cache.get(userId);
  if (!db) { db = new LocalDb(userId); cache.set(userId, db); }
  return db;
}
```
// Source: Dexie 4 `EntityTable` / `version().stores()` API [ASSUMED from Dexie 4 docs knowledge; confirm the `EntityTable` type name against node_modules/dexie/dist/dexie.d.ts after install]

Notes:
- Store a numeric `pending` (0/1) index field derived from `dirty`, because IndexedDB cannot index booleans or nested objects. Query `where("pending").equals(1)`.
- `deleted` likewise as 0/1.

### Pattern 2: Recorder writes Dexie on its existing tick, not per phrase
Keep `AUTOSAVE_MS = 5000`. In the new `save()`: (1) `await repo.putParts(id, partsRef.current, durationSec)` (sets `dirty.tail`), (2) `sync.poke(id)`, (3) set `saveState` from the local write result plus the engine's status. Also persist on `visibilitychange → hidden` and `pagehide` (best-effort), and in `stop()` before `repo.finish(id)`. A 10 h transcript is about 1 MB. One structured-clone put every 5 s is acceptable. One put per phrase (~every 1.5 s) for every Deepgram interim growth is not needed. [ASSUMED: cost not measured on the phone]

### Pattern 3: Split transcript from metadata (table layout, within discretion)
D-02 lists `parts` in the meeting record. A Dexie `toArray()` on `meetings` cannot project fields, so the list's `useLiveQuery` would deserialize every local transcript (MBs) on every change. **Recommend keeping one row per meeting in a sibling `transcripts` table keyed by the same `id`** (no chunking, same 1 MB per meeting), written in the same transaction as the metadata. This keeps D-02's "not chunked" intent and its fields. The planner should note this as a table-layout choice under Claude's Discretion. If the planner prefers D-02 literally, the list must use `db.meetings.toCollection().each()` with manual projection, which is still a full read.

### Pattern 4: Sync loop under Web Locks with an in-tab fallback
```ts
// src/lib/local/sync.ts (shape)
async function withSyncLock(fn: () => Promise<void>) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    // ifAvailable: another tab already syncing → skip; it will see our dirty rows
    return navigator.locks.request("transcriber-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await fn();
    });
  }
  if (running) { rerun = true; return; }
  running = true;
  try { do { rerun = false; await fn(); } while (rerun); } finally { running = false; }
}
```
Web Locks need a secure context, so `http://192.168.x.x` dev pages fall back to the mutex. The in-tab mutex must also coalesce pokes (a `rerun` flag), or a poke during a running pass is lost until the next timer. Android WebView supports `navigator.locks` (Chrome 69 based). [ASSUMED: from MDN BCD knowledge, not re-fetched this session]

`flush(id)` (D-12, and `stop()`) must not be skipped by `ifAvailable`. Implement it as "poke, then wait until the meeting's `pending` is 0 or the pass reports an error/timeout", by awaiting a promise resolved by the engine's status store. Do not hold a second lock.

### Pattern 5: Tail batching with the unchanged protocol
```ts
// syncCore.ts — pure
export const MAX_BATCH_PARTS = 2000;
export const MAX_BATCH_BYTES = 900_000; // Vercel request body limit is 4.5 MB
export function nextTailBatch(parts: Part[], savedParts: number) {
  const from = Math.max(0, Math.min(savedParts - 1, parts.length));
  let end = from, bytes = 0;
  while (end < parts.length && end - from < MAX_BATCH_PARTS) {
    bytes += parts[end].text.length * 3 + 40; // worst-case UTF-8 (Devanagari is 3 bytes/char)
    if (bytes > MAX_BATCH_BYTES && end > from) break;
    end++;
  }
  return { from, parts: parts.slice(from, end), done: end >= parts.length };
}
```
After each 2xx: `savedParts = data.savedParts`. If the batch was not the last, loop. The server has written `slice(0, from) + batch`, which truncates server parts beyond `end`. That is fine, because the local copy is complete and the next batch rewrites them. Only clear `dirty.tail` once `savedParts === parts.length` **and** no new parts arrived during the pass (compare a `localRev` counter that `putParts` increments).

### Pattern 6: Idempotent create (server)
```ts
// POST /api/meetings
const id = body.id; // optional, zod regex ^[a-z0-9_-]{16,40}$
if (!id) { /* old path: create, 201 */ }
try {
  const m = await prisma.meeting.create({ data: { id, userId, title, language, deviceName, engine,
            ...(createdAt ? { createdAt } : {}) }, select: { id: true, title: true } });
  return Response.json({ meeting: m, savedParts: 0 }, { status: 201 });
} catch (e) {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) return dbDown(e);
  const existing = await prisma.meeting.findUnique({ where: { id }, select: { id: true, title: true, userId: true, transcript: true } });
  if (!existing || existing.userId !== userId) return Response.json({ error: "Id in use" }, { status: 409 });
  const savedParts = Array.isArray(existing.transcript) ? existing.transcript.length : 0;
  return Response.json({ meeting: { id: existing.id, title: existing.title }, savedParts }, { status: 200 });
}
```
Create-then-catch-P2002 is race-free (two concurrent retries cannot both create). The client must treat 200 and 201 the same and adopt `savedParts` from the response when it is lower than the local cursor. Clamp `createdAt`: accept only values that are not in the future (allow up to +5 min of clock skew) and not before 2020, otherwise use `now()`. [CITED: Prisma error reference P2002 = unique constraint failed, known from Prisma docs; ASSUMED not re-fetched]

### Pattern 7: Title LWW as one atomic conditional update
```ts
if (title !== undefined) {
  const t = titleUpdatedAt ? new Date(titleUpdatedAt) : new Date(); // old clients: server time
  await prisma.meeting.updateMany({
    where: { id, userId, OR: [{ titleUpdatedAt: null }, { titleUpdatedAt: { lt: t } }] },
    data: { title, titleUpdatedAt: t },
  });
}
```
Run the rest of the patch (durationSec, status, engine, speakerNames) as a separate unconditional `updateMany`, so that a losing title never blocks a `status: "DONE"`. Return `{ ok: true, title: <stored title> }` so the client can adopt the winner. Return 404 only when the meeting does not exist (check `count` of the unconditional update, or do a cheap existence check).

### Pattern 8: Pull with server-provided cursor
`GET /api/meetings?since=ISO` returns `{ meetings: [...changed, select incl. engine, titleUpdatedAt, updatedAt], ids: string[], serverTime: ISO }`. Store `serverTime` (minus ~5 s overlap) as `lastPullAt` in `kv`. Never use the device clock for `since`. Without `since` it returns the old list plus `ids` and `serverTime`, so existing callers are unaffected. Merge rules live in `syncCore.mergePulledMeeting(local, server)`:
- `document`, `template`: always take the server's.
- `title`: take the server's if `server.titleUpdatedAt > local.titleUpdatedAt` or the local title is not dirty.
- `status`, `durationSec`, transcript: take the server's only when local is not dirty and `origin !== "native"`, or when it's native and finished.
- Missing from `ids`: delete locally unless `pending`, in which case clear `savedParts` to 0 and mark create+tail dirty (re-create).

### Pattern 9: Meeting page fallback (no offline shell yet)
`src/app/meetings/[id]/page.tsx` today calls `notFound()` when there is no row. Change it to render `<LocalMeetingView id={id} />` (a client component reading Dexie via `useLiveQuery`) when the row is missing **or** the Prisma call throws. `LocalMeetingView` renders the existing `MeetingView` with data from Dexie, or the "Meeting not found" message if Dexie has nothing either. Validate `id` with the same regex first, so random URLs don't try IndexedDB. When the server row exists, `MeetingView` calls `repo.cacheServerMeeting(meeting)` once on mount (only when the local copy is not dirty), so the Phase 3 offline open has data.

### Anti-Patterns to Avoid
- **Awaiting the network in `start()` for on-device engines.** That is the current behaviour (L844 throws), and it is exactly what OFF-03 removes. Keep the awaited POST for the native path only.
- **Two JS writers per meeting.** After this phase, every web PATCH of a local meeting goes through `sync.ts`. `useRecorder.save()` must stop calling `fetch` itself, except the best-effort `pagehide` keepalive (see Pitfall 4).
- **Clearing data on sign-out or 401.** Neither `signOut` nor a 401 may touch IndexedDB.
- **Using pyannote-style server ids or `rev` vectors.** Out of scope; field ownership is enough (single writer per transcript).
- **Opening Dexie at module scope** in a file imported by a client component (it runs during SSR).
- **Pushing `document`/`template` from the device.** The PATCH zod schema doesn't even accept them. Keep it that way.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IndexedDB schema/migrations/reactivity | raw `indexedDB.open` + onupgradeneeded + custom events | Dexie 4 + `useLiveQuery` | Versioned upgrades, transactions, cross-tab change propagation |
| Cross-tab single sync loop | localStorage heartbeats / leader election | `navigator.locks.request(name, {ifAvailable:true})` | Released automatically when a tab dies |
| Random ids | `Math.random` strings | `crypto.randomUUID()` (36 chars, lowercase hex + `-`, matches the regex), fallback `crypto.getRandomValues` → 24 hex chars | `randomUUID` needs a secure context; `getRandomValues` does not |
| Dedupe on create | client-side "already created?" flags | server create + P2002 catch | Lost responses are the main dup cause |
| Title conflict | read-compare-write in JS | single conditional `updateMany` | Atomic in Postgres |
| Reachability | `navigator.onLine` alone | `/api/health` probe with `AbortSignal.timeout(4000)` | Wi-Fi without internet reports online |

**Key insight:** the existing tail protocol already gives idempotency and self-healing (409). The work is making the local copy durable and making create idempotent, not inventing a new sync algorithm.

## Runtime State Inventory

This is partly a migration of where meetings live, so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Neon `Meeting` rows (cuid ids). Existing ids are 25-char lowercase alphanumerics, which match `^[a-z0-9_-]{16,40}$`. No IndexedDB data exists yet. | None for existing rows. New columns are nullable, so there's no backfill. `engine` stays null for old meetings. |
| Live service config | Vercel deployment (user-deployed); Neon schema must get the 3 new columns via the user's `npx prisma db push` | **Human checkpoint:** the user runs `npx prisma db push` **before** deploying the new build. |
| OS-registered state | Installed APKs load the remote `server.url`, so they get new JS on deploy. The RecordingService (Java) contract is unchanged. | None. No APK rebuild needed in this phase (no new plugins; `@capacitor/network`/`app` already shipped in Phase 1). Old APKs without those plugins: feature-detect with `hasPlugin("Network")`/`hasPlugin("App")`. |
| Secrets/env vars | None renamed | None |
| Build artifacts | `node_modules/.prisma/client` regenerates on `npx prisma generate` and on `postinstall`. On Windows, `prisma generate` fails with EPERM if `next dev` holds the query-engine DLL. | Stop the dev server before `npx prisma generate`. |

## Common Pitfalls

### Pitfall 1: Prisma client generated with new columns that are not yet in Neon
**What goes wrong:** `findFirst({ where })` without `select` makes Prisma name every scalar column, so the meeting page, `GET /api/meetings/:id` and `/process` fail with P2022 ("column … does not exist") until the push. Any PATCH that writes `titleUpdatedAt` fails the same way. [MEDIUM: Prisma behaviour from experience plus community reports of P2022 on schema drift, see Sources]
**How to avoid:** (1) A blocking `checkpoint:human-action` in the server plan: "Run `npx prisma db push` on Neon before deploying." Pushing first is safe because the old code doesn't name the new columns. (2) Put explicit `select` objects in `src/lib/meetingSelect.ts` (`MEETING_FULL_SELECT` with new fields, used by GET/:id and the page; `/process` selects only what it needs, without new fields) so the blast radius is limited to code that really needs the new columns. (3) Optional belt-and-braces: in GET `/api/meetings/:id` and the page, catch `P2022` and retry with a legacy select. It's about 10 lines and makes an out-of-order deploy degrade instead of breaking. Recommended because the user deploys by hand.
**Warning signs:** 500 on every meeting page right after deploy.

### Pitfall 2: Native recorder started with an id the server doesn't have
**What goes wrong:** If the native path generated a client id and started the service without a successful POST, every service PATCH returns 404 → "error" for the whole meeting, and the final save fails after 5 attempts.
**How to avoid:** Keep `await POST /api/meetings {id, …}` before `MeetingRecorder.start` in `useNativeRecorder` (Deepgram needs the network anyway). As a safety net, the sync engine *may* push the idempotent **create** for `origin:"native"` meetings (never the tail). Then a transient POST failure followed by a retry still converges.

### Pitfall 3: Clearing `dirty.tail` while new parts arrived mid-request
**What goes wrong:** The engine reads parts (N), PATCHes, and meanwhile the recorder writes N+3. If the engine then sets `dirty.tail = false`, the last 3 parts never sync until the next write.
**How to avoid:** `putParts` increments `localRev`. The engine records the rev it read and only clears pending if the rev is unchanged (do this inside a Dexie `transaction('rw', …)` with a read-compare-write).

### Pitfall 4: `pagehide` and the keepalive PATCH
**What goes wrong:** On page close, an async Dexie write may not finish, and the sync engine can't run. The current code sends a keepalive PATCH, which is the only thing that saves the last seconds today.
**How to avoid:** On `pagehide`: start the Dexie put (best-effort) **and** keep the existing keepalive PATCH (body < 60 KB) built from `savedParts` read from an in-memory mirror of the persisted cursor. It is safe with the protocol: the response is lost, so the cursor isn't advanced, and the next sync resends from the persisted cursor (replace semantics, idempotent). If the keepalive overwrote with *fewer* parts than the server has, the next sync's `from` is still ≤ the server length, so it simply rewrites. If the server is shorter than the cursor, the next sync gets 409 and resets. Also save on `visibilitychange → hidden` (fires earlier and more reliably on Android).

### Pitfall 5: Orphaned "RECORDING" meetings after a kill
**What goes wrong:** The app is killed mid-recording, so the local meeting stays `status: "RECORDING"` and `dirty.finish` is never set. The server shows it as "Live" forever, and the tail may be incomplete.
**How to avoid:** On engine start (SyncProvider mount), for each local `origin:"local"` meeting with `status === "RECORDING"` whose id is not the active recorder's id (`recordingFlag.ts` or an in-memory registry), mark it `status: "DONE"`, `dirty.finish = true`, `dirty.tail = true`. Do not do this for `origin:"native"`, whose service may still be running. Check `MeetingRecorder.getState()` first.

### Pitfall 6: 409 loops and cross-account ids
**What goes wrong:** POST returns 409 (id owned by another user, practically only if two accounts share a device and the namespacing is wrong). The engine retries forever.
**How to avoid:** 409 on **create** → set `syncError = "conflict"` and stop retrying that meeting (show "Couldn't sync" badge). 409 on **tail** is the normal resync and loops at most a few times per pass (cap at 3 consecutive 409s per meeting per pass).

### Pitfall 7: Request size
**What goes wrong:** The first sync of a long offline meeting sends a big tail. 2000 parts are normally ~200 KB, but zod allows 5000 chars per part, so the worst case is 10+ MB, over Vercel's ~4.5 MB body limit (HTTP 413 from the platform, not the JSON 413 from the route). [ASSUMED: Vercel limit from training knowledge]
**How to avoid:** Batch by parts **and** bytes (Pattern 5). Treat 413 as "halve the batch".

### Pitfall 8: Session not ready when Record is tapped
**What goes wrong:** `useSession()` is `loading` for a moment after page load. Without a userId the DB name is unknown.
**How to avoid:** `SyncProvider` stores `lastUserId` in localStorage when the session is authenticated, and exposes `currentUserId = session?.user.id ?? lastUserId`. If neither exists, `useRecorder` falls back to today's behaviour (awaited POST), so nothing regresses. On a real `unauthenticated` session, stop the engine but keep the DB. A different user later opens a different DB.

### Pitfall 9: `router.refresh()` and server props overwriting local edits
**What goes wrong:** After a local-first rename, `router.refresh()` re-renders the server page with the old title (sync hasn't run yet).
**How to avoid:** `MeetingView` already holds the title in `useState` (initialised once), so a refresh doesn't reset it. For the list, merge so that a local record with `dirty.meta` wins for `title`. Don't call `router.refresh()` immediately after local edits. Call it after the engine reports the meeting is synced, or not at all.

### Pitfall 10: Deleting then pulling
**What goes wrong:** A delete is tombstoned locally, then a pull runs before the DELETE and re-creates the row.
**How to avoid:** Push before pull in each pass. The merge ignores server rows whose local record has `deleted = 1`. The list filters out `deleted = 1`.

### Pitfall 11: AI minutes on a half-synced meeting
**What goes wrong:** `/process` summarises the server copy, which lacks the offline tail.
**How to avoid:** `generate()` calls `await sync.flush(id)` (timeout ~20 s). If the meeting is still pending, show "Waiting to upload the transcript. Connect to the internet and try again." When `/process` returns (or the polling finds the doc), write `document`/`template` into Dexie via `repo.setServerDocument` (not pending).

### Pitfall 12: Dexie write failures (quota / private mode)
**What goes wrong:** Writes can throw `QuotaExceededError`, or IndexedDB can be unavailable (some private modes or embedded views).
**How to avoid:** `repo` functions return a result and never throw into the recorder. `useRecorder` falls back to the direct server path when `repo.available === false` (keeps today's behaviour). Call `navigator.storage.persist()` once (best-effort) after the first local meeting.

## Code Examples

### Recorder `save()` after the change (shape)
```ts
const save = useCallback(async (status?: "DONE", closing = false) => {
  const id = meetingIdRef.current;
  if (!id) return true;
  if (!local.available) return legacySave(status, closing);      // unchanged old function body
  const ok = await repo.putParts(userId, id, partsRef.current, secondsRef.current, status);
  if (closing) sendKeepaliveTail(id);                              // Pitfall 4
  if (!ok) return legacySave(status, closing);
  if (status) await sync.flush(id, { timeoutMs: 15_000 });         // stop(): keep today's retry feel
  else sync.poke(id);
  return true;                                                     // saved on device
}, []);
```
`saveState` is then derived from `useSyncStatus(id)`: `"synced"` → "Synced", `"pending"`+reachable → "Saving", `"pending"`+unreachable → "Waiting for internet", `"needs-auth"` → "Sign in to sync". Extend `RecorderState.saveState` with a value such as `"local"` (saved on device, not synced) and keep `"saved"` meaning synced, so the native path (which reports the Java strings) is unchanged. Update `Recorder.tsx` L166 to show the meeting link once the meeting is `"local"` or `"saved"`, since the page can now open it from Dexie.

### Health route
```ts
// src/app/api/health/route.ts
export const dynamic = "force-dynamic";
export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
```
Do not call `getUserId()` here (it's a reachability probe; no DB, no auth).

### Speakers relabel endpoint (D-14)
```ts
const Body = z.object({
  relabel: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })).max(50).optional(),
  parts: z.array(z.object({ index: z.number().int().min(0), speaker: z.number().int().min(0) })).max(60_000).optional(),
  speakerNames: z.record(z.string().regex(/^\d{1,2}$/), z.string().trim().max(60)).optional()
    .refine((r) => !r || Object.keys(r).length <= 50),
});
// findFirst {transcript} scoped by userId → map parts (relabel map applied simultaneously, not chained,
// so {0→1, 1→0} swaps) → apply per-index overrides (ignore out-of-range) → updateMany. Idempotent.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-assigned cuid on create, record only after POST | Client id + idempotent upsert | This phase | Recording starts offline; retries can't duplicate |
| In-memory `savedPartsRef` | Persisted `savedParts` in Dexie | This phase | Kill/reload resumes without truncation |
| `useRecorder.save()` does the fetch | `sync.ts` is the only JS writer | This phase | One retry/backoff policy; works after unmount |
| Background Sync API | Foreground triggers (poke/online/resume/timer) | n/a (`SyncManager` unsupported in Android WebView, per project STACK research) | Sync only while the app/page is open |

## Recommended Task Decomposition

Coarse granularity. Two waves can run in parallel.

**Plan 02-01 (Wave 1): Server contract, additive**
1. `prisma/schema.prisma`: add `speakerNames Json?`, `engine String?`, `titleUpdatedAt DateTime?`. Stop dev server, `npx prisma generate`. (No db push.)
2. `src/lib/meetingSelect.ts`, and explicit selects in `GET /api/meetings/:id`, `meetings/[id]/page.tsx`, `/process` (+ optional P2022 legacy fallback).
3. `POST /api/meetings`: optional `id` (regex), `createdAt` (clamped), `engine` (`z.enum(["deepgram","moonshine","whisper"])`), create + P2002 → 200/409 (Pattern 6). Old body → 201 unchanged.
4. `PATCH /api/meetings/:id`: `titleUpdatedAt` LWW (Pattern 7), `speakerNames`, `engine`. Tail path unchanged byte-for-byte in behaviour.
5. `PATCH /api/meetings/:id/speakers` (D-14). `GET /api/meetings` adds `engine`, `titleUpdatedAt`, `ids`, `serverTime`, optional `since`. `GET /api/health`.
6. `checkpoint:human-action`: user runs `npx prisma db push` before deploying. Document it in the plan summary and README deploy notes.
Verify: `npm run typecheck`, `npm run build`, curl-free contract review (no DB available to the executor until push).

**Plan 02-02 (Wave 1): Local store + pure sync core**
1. `checkpoint:human-verify` (slopcheck unavailable) → `npm install dexie@4.4.7 dexie-react-hooks@4.4.0`.
2. `ids.ts`, `types.ts`, `db.ts` (Pattern 1, with `transcripts` sibling table per Pattern 3), `repo.ts` (all functions return results, never throw).
3. `syncCore.ts` (pure, no runtime imports): `nextTailBatch`, `applyTailResponse`, `classifyResponse` (2xx/401/409/413/404/5xx/network), `backoffDelay` (e.g. 2 s × 2^n, cap 60 s, jitter), `mergePulledMeeting`, `shouldClearPending(localRev)`.
4. `tests/syncCore.test.ts` with `node:test` (relative `../src/lib/local/syncCore.ts` import), `"test": "node --test tests/"` script, `tests` added to tsconfig `exclude` (because `.ts` import extensions fail `tsc` without `allowImportingTsExtensions`).
5. `src/lib/connectivity.ts`: `isReachable()` (onLine false → false fast; else probe `/api/health` with a 4 s timeout, cached 10 s), `onConnectivityHint(cb)` (window `online`, `@capacitor/network` when `hasPlugin("Network")`).

**Plan 02-03 (Wave 2, depends on 01+02): Sync engine + provider**
1. `sync.ts`: lock (Pattern 4), triggers (poke, online, visibilitychange visible, `App.appStateChange` active, timer 5 s when any local meeting is RECORDING else 30 s), per-meeting push order create → tail batches → meta → finish → delete, then pull. Status store via `useSyncExternalStore` (`idle | syncing | offline | needs-auth`, plus per-meeting pending). `flush(id, {timeoutMs})`.
2. `SyncProvider.tsx` inside `SessionProvider` in `Providers.tsx`: userId binding, `lastUserId`, orphan recovery (Pitfall 5), `storage.persist()`.
3. 401 → `needs-auth`. Any later 2xx or session change → resume.

**Plan 02-04 (Wave 3): Recorder integration**
1. `useRecorder`: id at start, `repo.createLocal` before mic/model, poke instead of awaited POST for on-device engines and web Deepgram. A 401 no longer aborts on-device recording (status line notes "sign in to sync"). `save()` per the code example. `stop()` keeps the retry loop semantics via `flush` and the same final messages, adjusted ("Saved on this device. Will upload when online."). `pagehide`/`visibilitychange` keepalive.
2. `useNativeRecorder`: id + `createLocal(origin:"native")` + awaited POST with id, unchanged service start. Throttled mirror (≤ every 5 s) of `partsRef` into Dexie. On `finished && saveState === "saved"`, mark the mirror clean (pull will refresh it).
3. `Recorder.tsx` save badge + meeting-link condition.
Regression checks: online web Deepgram and Moonshine recordings still show Saving/Saved every ~5 s, the network tab shows the same PATCH cadence/body shape, and the native path's request sequence is identical apart from `id` in the POST body.

**Plan 02-05 (Wave 3): UI integration**
1. `MeetingList`: `useLiveQuery` of local metadata merged with server props (dedupe by id; local pending wins for title/status/duration; filter `deleted`), "Not synced yet" badge for `pending`, `syncError` badge "Couldn't sync".
2. `meetings/[id]/page.tsx` fallback → `LocalMeetingView` (Pattern 9). `MeetingView` caches the server meeting locally.
3. `MeetingView`: rename → `repo.setTitle` (titleUpdatedAt = now, pending) + poke; delete → tombstone + poke + navigate; generate → `flush` first (Pitfall 11) and write the result to Dexie.

## Manual Verification Checklist (maps to the success criteria)

Laptop browser with DevTools (no adb needed):
1. **SC1:** DevTools Network "Offline" (or block `/api/*`), record with Moonshine ~1 min, stop, close the tab, reopen `/meetings`: the meeting is listed with "Not synced yet" and opens (from Dexie).
2. **SC2:** Go back online: within ~30 s (or on focus) the badge disappears. From another browser profile signed in as the same user, the meeting appears once with the full transcript. Check Neon (or the list) for no duplicate ids.
3. **SC3a:** Throttle to "Slow 3G", record ~3 min with the server reachable, kill the tab mid-PATCH, reopen: transcript length on the server equals local (no duplicates, no gaps). Re-run a sync manually (`sync.poke`) twice: no change.
4. **SC3b:** Generate minutes online, then rename offline, then reconnect: minutes are still there and the rename wins.
5. **SC4:** Online Deepgram (web) and Moonshine: PATCH every ~5 s, "Synced" badge, Stop → "Saved". Android app (user test, Deepgram native, screen locked 2+ min): unchanged behaviour, meeting on server, no 404s in the service status.
6. Sign out with an unsynced meeting, sign back in: it syncs. Sign in as a different user: it is not shown.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Prisma 6 names all scalar columns for `findFirst` without `select` and fails with P2022 when one is missing | Pitfall 1 | Low. If wrong, the checkpoint is merely extra caution. |
| A2 | Dexie 4 exposes `EntityTable` and can be imported during SSR without touching IndexedDB | Pattern 1 | Compile error / SSR error. Check `node_modules/dexie/dist/dexie.d.ts` after install; keep the lazy getter regardless. |
| A3 | `navigator.locks` is available in the Android WebView used by the APK | Pattern 4 | Falls back to the in-tab mutex (single tab in the app anyway). |
| A4 | Vercel request body limit ≈ 4.5 MB | Pitfall 7 | Byte batching covers it either way. |
| A5 | One 1 MB IndexedDB put every 5 s is cheap enough on the owner's Xiaomi phone | Pattern 2 | Jank during long meetings → move to chunked `transcripts` (only last chunk rewritten). |
| A6 | Prisma `updateMany` bumps `@updatedAt` (so `?since=` sees tail/title changes) | Pattern 8 | If not, pull misses changes. Verify after push with one PATCH then GET `?since`. Fallback: set `updatedAt: new Date()` explicitly in each `updateMany` data (cheap, recommended anyway). |
| A7 | dexie / dexie-react-hooks are legitimate (slopcheck not run) | Package audit | Low (12-year-old project, official monorepo). Human-verify gate. |

## Open Questions

1. **Should the JS engine take over a native meeting whose final save failed?** After `finished && saveState === "error"` the service never writes again, and the Dexie mirror may hold the missing tail (if the screen was on). Recommendation: optional in 02-04. If `mirror.length >= n.partsCount`, convert it to `origin:"local"` with `pending` tail and learn the server length cheaply with `PATCH {transcriptTail:{from: 1e9, parts: []}}` → 409 `savedParts`. Otherwise leave it.
2. **Phase 4 needs the relabel endpoint shape now.** D-14 is specified; no further input needed.
3. **Where to show `needs-auth`.** Phase 2 only needs it in the recorder save badge and list badge; a global banner is Phase 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build, `node --test` | ✓ | 24.19.0 | — |
| npm | install | ✓ | 11.13.0 | — |
| Neon DB with new columns | runtime of new routes | ✗ until the user pushes | — | Explicit selects + optional P2022 fallback; human checkpoint |
| Android device / adb | native regression test | not used (constraint) | — | User runs the UAT on the phone |
| slopcheck | package audit | ✗ (install denied) | — | Human-verify checkpoint before `npm install` |

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (unchanged) | next-auth session; `getUserId()` on every new route except `/api/health` |
| V4 Access Control | yes | Every query scoped by `userId` (`updateMany`/`findFirst` with `userId`). Create with a foreign id → 409 with no data leak (don't return the other user's title) |
| V5 Input Validation | yes | zod: id regex, `createdAt` ISO + clamp, `engine` enum, `speakerNames` bounded record, relabel arrays bounded |
| V6 Cryptography | minimal | `crypto.randomUUID` / `getRandomValues` for ids (unguessable ids are defence in depth only; access is enforced by userId) |
| Data at rest (client) | yes | IndexedDB is per-origin and unencrypted; namespacing by userId separates accounts on one device but doesn't protect against device access. Acceptable for this product; note in summary |

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Id squatting/guessing another user's meeting id | Tampering / Info disclosure | 409 without echoing data; all reads scoped by userId |
| Oversized bodies (DoS on Neon) | DoS | zod max lengths, byte-bounded batches, existing MAX_PARTS |
| Back-dated `createdAt` / future `titleUpdatedAt` to always win LWW | Tampering (own data only) | Clamp timestamps to ≤ server now + 5 min |
| Cross-account data on a shared phone | Info disclosure | DB per userId; never upload a DB whose userId ≠ session userId (engine checks before each pass) |

## Sources

### Primary (HIGH confidence)
- Repo source read this session: `src/hooks/useRecorder.ts`, `src/hooks/useNativeRecorder.ts`, `src/lib/nativeRecorder.ts`, `android/.../recorder/RecordingService.java` (save/finish/onDestroy), `src/app/api/meetings/route.ts`, `src/app/api/meetings/[id]/route.ts`, `src/app/api/meetings/[id]/process/route.ts`, `src/app/meetings/page.tsx`, `src/app/meetings/[id]/page.tsx`, `src/components/{MeetingList,MeetingView,Recorder,Providers,AppShell}.tsx`, `src/lib/{auth,prisma,native}.ts`, `prisma/schema.prisma`, `package.json`, `tsconfig.json`, `next.config.ts`, `public/sw.js`
- npm registry (`npm view`, 2026-11-21): dexie 4.4.7, dexie-react-hooks 4.4.0 (peers), fake-indexeddb 6.2.8, vitest 5.1.1, tsx 4.23.15
- https://unpkg.com/dexie-react-hooks@4.4.0/dist/dexie-react-hooks.mjs: useLiveQuery/useObservable implementation, SSR guard
- https://dexie.org/docs/dexie-react-hooks/useLiveQuery(): signature, defaultResult, querier rules
- Local experiment: Node 24.19 `node --test` runs `.ts` tests natively

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` §3-5, §7; `PITFALLS.md` #8, #11, #12; `STACK.md` (MDN BCD for SyncManager/WebView)
- Prisma troubleshooting / P2022 community threads: https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/troubleshooting, https://www.answeroverflow.com/m/1375036929191579658

### Tertiary (LOW confidence)
- Vercel body limit, Web Locks WebView version, phone IndexedDB write cost (training knowledge; see Assumptions)

## Metadata

**Confidence breakdown:**
- Code contracts / integration points: HIGH, read directly
- Standard stack: HIGH (registry + locked decision); legitimacy ASSUMED (slopcheck not run)
- Architecture/sync design: HIGH for protocol reuse; MEDIUM for performance choices
- Pitfalls: HIGH for native 404 / orphan / rev race (from code); MEDIUM for Prisma P2022 and platform limits

**Research date:** 2026-11-21
**Valid until:** 2026-12-21
