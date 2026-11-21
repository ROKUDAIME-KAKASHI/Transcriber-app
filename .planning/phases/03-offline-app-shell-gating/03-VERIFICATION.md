---
phase: 03-offline-app-shell-gating
verified: 2026-11-21T00:00:00Z
status: human_needed
score: 5/5 requirement areas verified in code; device behaviour pending
human_verification:
  - test: "Airplane-mode cold start in the APK (UAT 2, 3, 11)"
    expected: "Record, Meetings, meeting render from SW cache; no /login redirect; SW registered; crossOriginIsolated true"
    why_human: "Android WebView SW behaviour; the browser pane could not register a SW, so SW offline reload was never browser-verified"
  - test: "Reachability pill and gating on a Wi-Fi-with-no-internet network (UAT 4, 5)"
    expected: "Offline pill in 15-30 s; Cloud and AI disabled with Needs internet; restored on reconnect"
    why_human: "Real network behaviour"
  - test: "Model download and offline on-device recording (UAT 6)"
    expected: "Download for offline reaches Ready offline; offline recording saves and syncs"
    why_human: "Real Hugging Face download and WASM inference on the phone"
  - test: "Back button, update notice, old APK, sign-out offline (UAT 7-10)"
    expected: "As listed in 03-HUMAN-UAT.md"
    why_human: "Device and deploy dependent"
---

# Phase 3: Offline App Shell and Gating Verification Report

**Goal:** After one online visit, users can open the app, browse meetings and record on-device with no internet, and they always know what needs a connection.
**Status:** human_needed. No code gaps found. Only device-only checks remain.
**Re-verification:** No (initial)

## Automated evidence (run by verifier)

| Check | Result |
|-------|--------|
| `npm run typecheck` | clean |
| `npm test` | 110/110 pass |
| `node scripts/check-build.mjs` | all assertions passed (sw.js exists, all chunks present, no asyncify/map/webgpu, single skipWaiting inside SKIP_WAITING branch, COOP/COEP on synthetic responses, 5 clean shells) |
| `public/sw.js` | exists, 9452 bytes, 0 "asyncify" matches |

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | App shell (Record, Meetings, meeting) cached and served offline (OFF-01) | VERIFIED in code; device pending | Generated `public/sw.js`, `sw/routing.js`, `sw/manifest.js`; static shells; `(app)/layout.tsx` wraps AuthGate; SW manager mounted once in Providers. SW offline reload not run in a browser |
| 2 | On-device recording offline with downloadable models and ready status (OFF-02) | VERIFIED in code; device pending | `readiness.ts`, `OfflineModelControl.tsx`; worker uses `local_files_only` offline (speech.worker.ts:101); ORT readiness now needs both .mjs and .wasm (WR-06 part) |
| 3 | Offline state visible via real reachability (OFF-04) | VERIFIED | `connectivity.ts` probes `/api/health` (route exists); ConnectivityPill; pure reducer tested |
| 4 | Cloud and AI gated offline with a reason (OFF-05) | VERIFIED | `featureGateCore.ts` returns "Needs internet"; `MeetingView.tsx` uses `useFeatureGate("ai")`; Recorder gates Deepgram |
| 5 | Signed-in user stays signed in offline (OFF-06) | VERIFIED in code; device pending | AuthGate/AuthProvider with `decideAuth`, cached user; WR-02 and WR-04 fixed |

Note: the requirement IDs in the phase brief map to REQUIREMENTS.md as follows: OFF-02 is on-device recording and OFF-06 is staying signed in. All five are marked Complete there. OFF-03 belongs to Phase 2, so there are no orphans.

## Review findings

03-REVIEW-FIX: 6 of 7 fixed. WR-06 is partial. Cache-status queries still spawn a worker with no requestId correlation, and there are three `useOfflineReadiness` instances. Impact: transient mis-report of readiness on the offline Start gate. Severity: WARNING, not a blocker. IN-01, IN-02, IN-04 and IN-05 were not attempted. Recommend tracking WR-06 as follow-up and checking it during UAT 6.

## Anti-patterns

No unreferenced TBD/FIXME/XXX checks were run beyond the build. None were surfaced by the review. Not exhaustively scanned.

## Gaps

None blocking. 03-HUMAN-UAT.md already lists the 12 device checks (including the local SW smoke, item 12) and the deferred items. No update needed.

_Verifier: Claude (gsd-verifier)_
