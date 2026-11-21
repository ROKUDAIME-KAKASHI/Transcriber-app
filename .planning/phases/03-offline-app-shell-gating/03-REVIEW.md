---
phase: 03-offline-app-shell-gating
reviewed: 2026-11-21T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - next.config.ts
  - sw/build.mjs
  - sw/manifest.js
  - sw/routing.js
  - sw/sw.template.js
  - scripts/check-build.mjs
  - src/app/(app)/layout.tsx
  - src/app/(app)/meeting/page.tsx
  - src/app/(app)/meetings/page.tsx
  - src/app/(app)/page.tsx
  - src/app/login/page.tsx
  - src/app/meetings/[id]/page.tsx
  - src/app/offline/page.tsx
  - src/components/AppShell.tsx
  - src/components/AuthGate.tsx
  - src/components/AuthProvider.tsx
  - src/components/ConnectivityPill.tsx
  - src/components/MeetingList.tsx
  - src/components/MeetingLoader.tsx
  - src/components/MeetingView.tsx
  - src/components/OfflineModelControl.tsx
  - src/components/Providers.tsx
  - src/components/Recorder.tsx
  - src/components/ServiceWorkerManager.tsx
  - src/components/SyncProvider.tsx
  - src/components/UpdateNotice.tsx
  - src/components/ui.tsx
  - src/lib/authCore.ts
  - src/lib/authStore.ts
  - src/lib/connectivity.ts
  - src/lib/connectivityCore.ts
  - src/lib/featureGate.ts
  - src/lib/featureGateCore.ts
  - src/lib/meetingId.ts
  - src/lib/meetingRoute.ts
  - src/lib/navStack.ts
  - src/lib/recordingFlag.ts
  - src/lib/speech/client.ts
  - src/lib/speech/models.ts
  - src/lib/speech/readiness.ts
  - src/lib/sw/register.ts
  - src/lib/sw/updateCore.ts
  - src/workers/speech.worker.ts
  - mobile/www/index.html
findings:
  critical: 0
  warning: 7
  info: 5
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-11-21
**Depth:** standard (cross-file on SW routing/caching, auth/offline gating, recording safety)
**Files Reviewed:** 43 (new test files were skimmed only for reliability, not individually reported)
**Status:** issues_found

## Summary

The SW design is sound. Hashed assets are precached, `/api` and RSC requests always pass through,
shells are keyed by build version, a failing precache fails the install, and synthetic responses
carry COOP/COEP. Auth gating treats a failed probe as "unreachable" and never as a sign-out. No
Critical defects were found: no secrets, no injection paths, and the meeting-id redirect is
regex-validated.

The defects are in lifecycle edges:

- the update-apply guard
- redirects that fire during a recording
- the Meetings list when IndexedDB is unavailable
- the build not asserting that the SW was generated

## Warnings

### WR-01: SW update can only be applied once per tab session (stale reload guard)

**File:** `src/lib/sw/register.ts:62-75`
**Issue:** `applyUpdate` writes `sessionStorage["sw.reloading"]` and clears it with a `setTimeout`
10 s later. The success path is `SKIP_WAITING` -> `controllerchange` -> `location.reload()`, and the
reload destroys that timer. The key therefore stays in sessionStorage for the rest of the session.
Every later call hits `if (sessionStorage.getItem(RELOAD_GUARD)) return;` and silently does nothing,
so the "Reload to update" button is a no-op after the first applied update. WebView and Android
Chrome keep sessionStorage across backgrounding, so users can hit this.
**Fix:** Store a timestamp and compare it, instead of relying on a timer:
```ts
const prev = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
if (prev && Date.now() - prev < 10_000) return;
sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
// drop the setTimeout
```

### WR-02: AuthGate redirects to /login mid-recording

**File:** `src/components/AuthGate.tsx:36-39`, `src/components/AuthProvider.tsx:62-66`
**Issue:** Any `ok-empty` probe result sends the user to `/login`, which unmounts `Recorder`.
`useRecorder`'s unmount cleanup then stops the recording (`useRecorder.ts` ~1037). Re-probes fire on
offline->online and on `visibilitychange` whenever conn is not "online", which is exactly the flaky
network case while recording. A session that expired during a long meeting, or a transient `{}`
from NextAuth, ends the recording abruptly. Phase context asks for recording-in-progress safety, and
there is already a `needs-reauth` gate state that exists for this case.
**Fix:** In `AuthGate`, when `probe === "ok-empty"` and `wasAuthed`, or when `isWebRecordingNow()`
is true, keep rendering children and let `useFeatureGate` show "Sign in again". Redirect only when
no recording is active:
```ts
if (decision === "redirect-login" && !isWebRecordingNow()) router.replace("/login");
```
Also guard the native recording (`isRecordingActive()`).

### WR-03: Meetings list is empty forever when IndexedDB is unavailable or no user id is known

**File:** `src/components/MeetingList.tsx:56-66, 83, 130-158`
**Issue:** The list no longer receives server props. When `userId` is null the live query returns
`null`, so `merged` is `[]` and "No meetings yet" is shown. It stays that way when
`localAvailable()` is false (Firefox private mode, blocked storage), where there is no local DB and
sync never starts, so a signed-in web user sees an empty list although the server has meetings.
Two further effects:
- On every cold start, before `SyncProvider` reads `lastUserId` in its effect, the first render
  flashes the "No meetings yet" empty state (sync idle, `lastSyncedAt` null, query result `null`
  rather than `undefined`).
- Offline-first users on the web who lose IndexedDB have no fallback at all.
**Fix:**
- Treat `userId === null` as loading, not empty: show the skeleton while `useLocalUser().userId` is
  null and auth is still probing.
- If `!available`, fetch `/api/meetings` as a fallback, or show an explicit "This browser can't
  store meetings offline" notice.

### WR-04: Failed `signOut` leaves sync stopped and last-user keys wiped

**File:** `src/components/AppShell.tsx:36-40`, `src/components/SyncProvider.tsx:19-31`
**Issue:** `markSignedOut()` runs before `signOut()` resolves. It clears `LAST_USER_KEY`, `LAST_EMAIL_KEY`
and calls `stopSync()`. If the signout request fails (flaky network is the normal case here, since
the button is gated only by `conn === "offline"`), NextAuth does not navigate, the session cookie is
still valid, and the app keeps running with sync halted. Nothing restarts it until the user reloads,
so unsynced meetings quietly sit pending. A concurrent re-probe (`visibilitychange`) can also
re-write the keys that were just cleared, so the sign-out is not reliably forgotten.
**Fix:** Call `markSignedOut()` after a successful `signOut({ redirect: false })` and then
`router.replace("/login")`, or restart sync in a `catch`.

### WR-05: `cancelPrefetch` can strand an in-flight model load

**File:** `src/lib/speech/client.ts:222-233` (and `isWorkerBusy`, `:178-180`)
**Issue:** `cancelPrefetch` terminates the shared worker when `isWorkerBusy()` is false, but that
check only looks at `pending` transcribe jobs and the web-recording flag. It does not cover a model
`load` in progress (for example a pre-warm via `loadSpeechModel` or a start that is "Getting
ready"). The termination path clears `ready`/`readyFor`, but unlike `fail()` it never calls
`failListeners`, so that load's promise never settles. The Recorder then hangs on "Loading speech
model". The same `isWorkerBusy` blind spot lets `prefetchModel` run concurrently with a load.
**Fix:** Track a `loading` flag (set in `loadSpeechModel`, cleared on ready/error) and include it in
`isWorkerBusy`, or route termination through the same code path as `fail()` so `failListeners` are
notified.

### WR-06: `cacheStatus` / readiness probes spawn the speech worker and can mis-report readiness

**File:** `src/lib/speech/client.ts:208-219`, `src/lib/speech/readiness.ts:70-75`, `src/components/Recorder.tsx:131-132`
**Issue:**
- `cacheStatus` calls `getWorker()`, so merely mounting `Recorder` creates the worker. Recorder
  calls `useOfflineReadiness` three times (moonshine, whisper, and the Control), and each re-runs on
  every `conn` change and every `visibilitychange`.
- `cacheWaiters` is keyed by model with no correlation id. A second `cache-status` request for the
  same model that arrives after the first reply resolves with a stale answer. A `fail()` call
  resolves every waiter with `false`, which downgrades "ready" to "none" or "partial" for a moment.
  Under `startGate`, an offline user can then briefly see Start disabled with "Not ready offline"
  although the model is cached.
- `ortCached()` uses a global `caches.match` on the wasm URL, which can match a copy held by any
  cache (including transformers-cache), not specifically the SW's `tr-assets-v1`. The readiness
  claim "works with no internet" is then only as strong as that one URL: the `.mjs` loader is not
  checked.
**Fix:** Query Cache Storage directly from the main thread (the transformers cache name is
`transformers-cache`) instead of going through the worker, or give each request a `requestId` as
`prefetch` does. Check both `/ort/ort-wasm-simd-threaded.mjs` and `.wasm`. De-duplicate the three
hook instances.

### WR-07: Build does not assert that `public/sw.js` was generated; `check-build` is not wired in

**File:** `next.config.ts:15-24`, `scripts/check-build.mjs`, `package.json` scripts
**Issue:** The SW is produced by a `compiler.runAfterProductionCompile` hook that is loaded through
a `new Function("u","return import(u)")` workaround. If that hook is skipped or throws on Vercel (a
Next 16.x Turbopack change, or the hook being unsupported there), the deploy still succeeds and
`/sw.js` 404s. `registerServiceWorker` swallows the error, so the app silently loses offline
support. `public/sw.js` is gitignored, so there is no fallback, and `check-build` is a manual
script that `npm run build` and Vercel never execute.
**Fix:** Chain the check into the build, e.g. `"build": "next build && node scripts/check-build.mjs"`,
or have the hook throw when `public/sw.js` is missing afterwards. Also make `registerServiceWorker`
log a console warning on registration failure.

## Info

### IN-01: Stale previous-meeting data can render for one frame

**File:** `src/components/MeetingLoader.tsx:97-100, 178`
**Issue:** `remote` is reset to `idle` in an effect after `id` changes, so the first render for the
new id can still hit `if (remote.kind === "ok") return <MeetingView key={id} meeting={remote.data} />`
and show the old meeting's data under the new key.
**Fix:** Store `id` inside the `Remote` state and ignore results whose id differs from the current
id.

### IN-02: 401 on a meeting fetch is presented as "belongs to another account"

**File:** `src/components/MeetingLoader.tsx:114`
**Issue:** `401/403/404` all map to the same "It may have been deleted, or it belongs to another
account" message. An expired session (401) should say "Sign in again" instead.
**Fix:** Split 401 into its own state.

### IN-03: Duplicate localStorage key constants

**File:** `src/components/SyncProvider.tsx:14-15`, `src/components/AuthProvider.tsx:6-7`
**Issue:** `LAST_USER_KEY` / `LAST_EMAIL_KEY` are defined in both files and exported from
`AuthProvider` but not imported by `SyncProvider`. A change to one silently breaks sign-out
clearing.
**Fix:** Import them from `AuthProvider` or move them to `authStore.ts`.

### IN-04: `rev` for lazy ORT assets is computed but never used for invalidation

**File:** `sw/build.mjs:39-44`, `sw/sw.template.js:55-57, 78-82`
**Issue:** `lazy` entries carry a content `rev`, but `WARM_LAZY` skips any URL already in the cache,
and the cache is keyed by URL only. If the ORT runtime is upgraded under the same file name, clients
keep the old wasm forever (the file is also served with `immutable`).
**Fix:** Put the rev in the cache key or URL (`/ort/x.wasm?v=<rev>` with `ignoreSearch:false` for
the lazy tier), or drop the unused field.

### IN-05: Minor lifecycle and robustness nits

**File:** `src/lib/connectivity.ts:46-58, 31-37`, `src/lib/navStack.ts:10-14`
**Issue:**
- `probe()` returns the in-flight promise even for `force: true`, so a probe that started before an
  `online` event can report a stale failure after it.
- The `retry-probe` `setTimeout` is not cleared on teardown.
- `/api/health` reports "online" on any 2xx, so a captive portal that answers 200 counts as online.
- `navStack`'s `popped` flag stays set if a `popstate` fires for a non-navigation event (hash or
  state-only), which can mislabel the next push as a "back".
**Fix:** Start a new probe when `force` is set and the in-flight one began before the hint. Check
`res.status === 204` only. Clear the retry timer on teardown.

---

_Reviewed: 2026-11-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
