---
phase: 03-offline-app-shell-gating
fixed_at: 2026-11-21T00:00:00Z
review_path: .planning/phases/03-offline-app-shell-gating/03-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 3: Code Review Fix Report

**Source review:** 03-REVIEW.md (Critical + Warning; Info only where trivial)
**Verification:** `npm run typecheck`, `npm test` (110/110 pass), `npm run build` and `node scripts/check-build.mjs` (all assertions pass).
Fixes were applied directly on `main`, one local commit each. Nothing was pushed or deployed.

## Fixed Issues

### WR-01: SW update could only be applied once per tab session
**Files:** `src/lib/sw/register.ts` — **Commit:** 486a504
The reload guard now compares a stored timestamp (10 s window) instead of relying on a timer that the reload destroys. This commit also adds the console warning on SW registration failure requested under WR-07.

### WR-02: AuthGate redirected to /login mid-recording
**Files:** `src/components/AuthGate.tsx` — **Commit:** b76a4e5
On `redirect-login`, `isRecordingActive()` (web flag plus native plugin) is checked. While recording, the app stays mounted with a "session expired, recording is safe, sign in after you stop" notice (feature gate already shows "Sign in again"), re-checked every 3 s, and the redirect happens once the recording ends. Requires human verification of the logic.

### WR-03: Meetings list empty when user id unknown / IndexedDB unavailable
**Files:** `src/components/MeetingList.tsx` — **Commit:** e79e6c4
A null user id now shows the skeleton (loading) instead of "No meetings yet"; when local storage is unavailable an explicit "This browser can't store meetings offline" notice is shown. The `/api/meetings` fetch fallback was not added (the explicit notice option from the review was used).

### WR-04: Failed signOut left sync stopped and last-user keys wiped
**Files:** `src/components/AppShell.tsx`, `src/components/SyncProvider.tsx` — **Commit:** 89c1be8
`signOut({ redirect: false })` first; only on success `markSignedOut()` then `router.replace("/login")`. A failed request leaves sync and keys untouched. Also resolves IN-03 (SyncProvider now imports the key constants from AuthProvider). Requires human verification of the logic.

### WR-05: cancelPrefetch could strand an in-flight model load
**Files:** `src/lib/speech/client.ts` — **Commit:** fb28db3
A `loadingModel` flag (set in `loadSpeechModel`, cleared on settle or worker failure) is included in `isWorkerBusy()`, so cancel and prefetch no longer terminate/overlap a load.

### WR-07: Build did not assert that public/sw.js was generated
**Files:** `next.config.ts` (plus the register.ts warning in 486a504) — **Commit:** 53814ef
The `runAfterProductionCompile` hook now throws if `public/sw.js` is missing or empty after generation, failing the build loudly. The `build` script is unchanged and no `postbuild` hook was added, to avoid any risk to the Vercel build; `check-build` stays a manual/CI step.

## Skipped Issues

### WR-06: cacheStatus / readiness probes spawn the worker and can mis-report readiness (partially fixed)
**File:** `src/lib/speech/client.ts:208-219`, `src/lib/speech/readiness.ts:70-75`, `src/components/Recorder.tsx:131-132`
**Fixed part (commit 9d50c0a):** `ortCached()` now requires both `ort-wasm-simd-threaded.mjs` and `.wasm`.
**Not done:** moving cache queries to the main thread, requestId correlation for `cache-status` (needs a worker protocol change), and de-duplicating the three `useOfflineReadiness` instances. These are a larger refactor of the worker protocol and hook sharing, which is risky without device testing; the mis-report is transient and only affects the offline Start gate briefly.

## Info

Only IN-03 was fixed (as part of WR-04). IN-01, IN-02, IN-04 and IN-05 were not attempted.

---

_Fixer: Claude (gsd-code-fixer)_
