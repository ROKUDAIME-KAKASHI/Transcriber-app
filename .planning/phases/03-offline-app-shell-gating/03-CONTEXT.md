# Phase 3: Offline App Shell & Gating - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning (decisions auto-selected from research/ARCHITECTURE.md, PITFALLS.md, STACK.md, SUMMARY.md)

<domain>
## Phase Boundary

After one online visit, the app (Android APK and website) opens with no internet: Record, the Meetings list and meeting pages render from a service-worker-cached static shell plus the Dexie store from Phase 2; the signed-in user is not bounced to /login; on-device models can be downloaded ahead and show "Ready offline"; an Offline indicator reflects real reachability; Deepgram Cloud and AI minutes are shown disabled with a one-line reason offline and turn on automatically when back online; deploys never break the app or reload it mid-recording.

Requirements: OFF-01, OFF-02, OFF-04, OFF-05, OFF-06.

NOT in this phase: speaker separation (Phase 4), Aurora Ink redesign / motion (Phase 5; small UI here only), screen-off on-device recording (stretch, out of milestone), bundling the app into the APK, offline first launch (the very first launch needs internet once).
</domain>

<decisions>
## Implementation Decisions

### Service worker (OFF-01)
- **D-01:** Service worker on the remote (`server.url`) origin; scope `/`; keep `server.url`, do NOT bundle into the APK. Serve it at the existing `/sw.js` URL so existing registrations upgrade in place and no `Service-Worker-Allowed` header is needed. The current `public/sw.js` (unconditional `skipWaiting` + `clients.claim`, offline.html only) is replaced.
- **D-02:** Implementation choice is a research item for plan-phase (verify against Next 16.2.9 + Turbopack, on Windows, and Vercel): (a) `@serwist/turbopack` + `serwist` 9.5.15, or (b) a hand-written SW fed by a build-time precache manifest (a script run after `next build`, listing the hashed `/_next/static/**` assets, static shell HTML, `/ort/*` wasm, icons, manifest). Prefer whichever works with the stock `npm run build` / Vercel build without webpack; if Serwist is not clearly working, default to (b). Do NOT use Serwist `defaultCache`; routes are explicit.
- **D-03:** Precache: static shell HTML for `/`, `/meetings`, `/meeting`, `/login`, `/offline`; all `/_next/static/**`; `/ort/ort-wasm-simd-threaded.{mjs,wasm}`; icons; `manifest.webmanifest`. Precache requests use real network responses (so COOP/COEP headers survive in cache). Never cache redirects or non-200 responses.
- **D-04:** Navigations: network-first with ~3 s timeout, then the cached shell for that pathname (`/meetings/<id>` and `/meeting` map to the `/meeting` shell; unknown paths fall back to the `/` shell or `/offline`). RSC requests (`RSC: 1` header / `_rsc` param): network-only; on failure `Response.error()` so Next does a full navigation, which the SW answers with the shell. `/api/*` is never intercepted or cached (including `/api/auth/*` and `/api/health`). Cross-origin requests (Hugging Face models) pass through untouched; the SW never caches models (transformers.js `transformers-cache` owns them). Do not enable `experimental.useOffline`.
- **D-05:** Any `Response` the SW builds itself (the `/offline` fallback, rewritten shells) must carry `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `next.config.ts` headers stay. Verify `crossOriginIsolated` is still true on shells served from cache.
- **D-06:** Updates: no automatic `skipWaiting()`. A new SW installs and waits. A small "Update ready" notice offers "Reload to update" (posts `SKIP_WAITING`, then reload) only when not recording; otherwise the update applies on the next launch. The recording flag (`src/lib/recordingFlag.ts`) gates it. Activation purges old caches by version prefix. A `ChunkLoadError` / failed dynamic import when not recording triggers one guarded reload (no loops); while recording it only shows a notice.
- **D-07:** Register only in production (as today). If SW registration fails or is unsupported the app must keep working online exactly as now. The existing `errorPath` page (`mobile/www/index.html`) copy is updated to "Open the app once with internet to set up offline use" with retry (first-ever launch offline is the only unsupported case).

### Static client shells (OFF-01)
- **D-08:** `/` (Record), `/meetings` and the meeting page become static client shells: no `getUserId()` / `redirect()` / Prisma in the server component, no `force-dynamic`. Data comes from Dexie (`useLiveQuery`) and is refreshed from `/api/meetings*` when reachable (Phase 2 sync already pulls). New static route `/meeting` reads the id from `?id=` (inside `Suspense`; also parses `/meetings/<id>` from `location.pathname` for old links the SW serves from the shell). `/meetings/[id]` stays working online (server redirect or thin client page) so old links and Phase 1/2 deep links keep working. Meeting links in the list point to the static route (`/meeting?id=`).
- **D-09:** The meeting loader: Dexie record first; if absent and reachable, fetch `GET /api/meetings/:id` and render (and store it); if absent and offline, a friendly "Not on this device yet. Open it once online" state. `LocalMeetingView` is the starting point; `MeetingView` already supports `source="local"`.
- **D-10:** Keep the Phase 1 navigation (brand link, back arrow, Android back handler) working with the new routes (back arrow parent `/meetings`).

### Auth offline (OFF-06)
- **D-11:** New client `AuthGate` wraps the app routes (not `/login`). Rules: `authenticated` renders the app and caches the user (existing `transcriber.lastUserId` in SyncProvider; also cache the email for the sidebar). `loading` renders a neutral skeleton. `unauthenticated` AND server unreachable AND a cached last user exists renders the app as that user (a network error is not a sign-out). `unauthenticated` AND server reachable (health ok) redirects to `/login` (keeps local data; only explicit sign-out clears last user). No cached user and offline shows "Sign in needs internet once" with retry. `SessionProvider refetchWhenOffline={false}`. APIs still enforce auth; a 401 pauses sync (Phase 2 D-08).
- **D-12:** `/login` is a static route; offline it shows a clear one-line message instead of a generic error on submit. Sign-in itself needs internet (accepted).

### Connectivity and Offline pill (OFF-04)
- **D-13:** Extend `src/lib/connectivity.ts` into a store with a `useConnectivity()` hook (`useSyncExternalStore`): state `online | offline | unknown`. Hints: `online`/`offline` events and `@capacitor/network` (already wired). Truth: `GET /api/health` probe (no-store, 4 s timeout, never touched by the SW) on start, on the `online` event, on visibility/app resume, every ~15-30 s while the tab is visible, and immediately after any failed API fetch (`markUnreachable`). Offline when the probe fails (covers Wi-Fi with no internet); back online as soon as a probe succeeds (probe promptly after the `online` event). A single failed probe while `navigator.onLine` is true is retried once before flipping to offline (avoid flicker). Existing `isReachable()` and Phase 2 sync keep working.
- **D-14:** A small `ConnectivityPill` ("Offline") shows in the AppShell top bar (phone) and sidebar (laptop) only when offline, with `role="status"` / `aria-live="polite"`. Not shown while `unknown` at startup. Disappears when reachable again. Tapping it shows a one-line explainer: what still works offline (on-device recording, saved meetings) and what does not (Cloud recording, AI minutes).

### Feature gating (OFF-05)
- **D-15:** One `FeatureGate` helper/hook: `useFeatureGate("deepgram" | "ai")` returns `{enabled: boolean, reason: string | null}` (reasons: "Needs internet", "Sign in again to use this"). AI never blocks on sync because Phase 2 D-12 flushes before `/process`. Enabled when reachable and signed-in; auto-enables when connectivity returns (no reload).
- **D-16:** Deepgram: the Cloud engine option on the Record screen is disabled with the one-line reason; if Cloud is the stored/default engine (APK default) and offline, the effective engine for this session is the on-device engine with a note "Offline, using on-device", WITHOUT overwriting the saved preference; when back online and idle the saved choice is honored again. A recording already in progress is never interrupted by connectivity changes.
- **D-17:** AI minutes: the "Generate"/regenerate buttons in MeetingView (and any other AI entry point) are disabled with the reason shown next to them and re-enable automatically. Existing minutes and transcripts stay readable offline.
- **D-18:** Honest on-device offline recording copy: the Record screen says on-device recording works with no internet but the screen must stay on (the WebView/ASR stops when the screen locks); Cloud keeps recording with the screen off but needs internet. Reuse the existing battery/screen-on note pattern; no promise of locked-screen offline recording.

### Download for offline models (OFF-02)
- **D-19:** A "Download for offline" control on the Record screen (for on-device engines, online only to start) downloads the models the chosen engine needs (preferred model plus its fallback, e.g. Moonshine Base + Tiny; Whisper Base) via the existing `loadSpeechModel` path with a progress bar; sizes from `MODELS[...].sizeMb` are shown ("~90 MB"). It warns about size (mobile data), is cancelable/resumable best-effort, and calls `navigator.storage.persist()`.
- **D-20:** Status per engine: "Not downloaded" / "Downloading n%" / "Ready offline" / error. Readiness is verified against what is actually in Cache Storage (`transformers-cache` entries for the model repo files + ORT wasm), not only a localStorage flag; a flag may cache the result. Offline, selecting an engine whose model is not ready shows "Not ready offline. Download needs internet" and disables Start with that reason; a ready engine records and transcribes with zero network requests (verify no remote fetch is attempted when cached; the transformers.js `env` settings are a research item).
- **D-21:** No automatic large downloads: the existing online first-use behaviour (model downloads when you first record) stays. The explicit control is additive.

### Claude's Discretion
SW source layout and manifest generation script, cache names and versioning, exact timeouts and probe cadence, AuthGate skeleton visuals, pill/notice component details, wording of reasons, how Cache Storage readiness is probed, and test strategy (pure-logic tests with `node --test` for URL routing / manifest / gate logic; the rest verified via `npm run build` + `npm start` on port 3001 and the built-in browser, stopping the server to simulate offline).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/ARCHITECTURE.md` sections 0 (D1-D9), 2 (remote-origin SW details), 3, 5.1, 7, 8 - SW, shells, AuthGate, connectivity, FeatureGate
- `.planning/research/PITFALLS.md` - SW hazards, version skew, offline vs screen-off
- `.planning/research/STACK.md` - Serwist notes, ground-truth table (Capacitor bridge injection on SW-served pages, WebView support matrix, transformers cache)
- `.planning/research/SUMMARY.md`, `.planning/research/FEATURES.md` (Aurora Ink; styling context only, redesign is Phase 5)
- `.planning/REQUIREMENTS.md` (OFF-01, 02, 04, 05, 06), `.planning/ROADMAP.md` Phase 3 success criteria
- `.planning/phases/02-local-first-meetings-sync/02-CONTEXT.md` - Dexie store, sync, connectivity.ts, SyncProvider `lastUserId`, LocalMeetingView
- `.planning/phases/01-export-share-navigation/01-CONTEXT.md` - native.ts capability layer, nav/back handler, overlays
- `next.config.ts` (COOP/COEP headers), `public/sw.js`, `public/offline.html`, `mobile/www/index.html`, `capacitor.config.ts`
- `src/app/page.tsx`, `src/app/meetings/page.tsx`, `src/app/meetings/[id]/page.tsx`, `src/app/login/page.tsx`, `src/lib/auth.ts`
- `src/components/Providers.tsx`, `SyncProvider.tsx`, `AppShell.tsx`, `Recorder.tsx`, `MeetingView.tsx`, `MeetingList.tsx`, `LocalMeetingView.tsx`
- `src/lib/connectivity.ts`, `src/lib/native.ts`, `src/lib/speech/models.ts`, `src/lib/speech/client.ts`, `src/workers/speech.worker.ts`, `src/lib/recordingFlag.ts`
- `node_modules/next/dist/docs/` (docs bundled with Next 16.2.9)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `connectivity.ts` (`isReachable`, `markUnreachable`, `onConnectivityHint`; `/api/health` exists), `native.ts` (`hasPlugin`, `getNetwork`), `recordingFlag.ts`.
- `SyncProvider` already persists `transcriber.lastUserId` and exposes `useLocalUser()`; `LocalMeetingView` renders from Dexie; `MeetingList` already merges Dexie + server rows.
- `loadSpeechModel` / `preferredModel` in `speech/client.ts` and the `MODELS` registry for the download control; `requestPersist` in `local/repo`.
- UI primitives in `ui.tsx` (Badge, Notice, Button, OptionList); engine list `ENGINES` / `APP_ENGINE_NOTES` in Recorder.

### Established Patterns
- Client components, Tailwind v4 tokens, lucide icons; server pages currently `force-dynamic` with Prisma + `redirect("/login")` (to be removed for the three shells).
- `public/sw.js` registered only in production from `Providers`.

### Integration Points
- Providers (register SW, mount AuthGate / update notice), AppShell (pill), Recorder (engine gating, download control, copy), MeetingView (AI gating), page.tsx files (static shells), new `/meeting` route, `next.config.ts` / build script (SW manifest), `mobile/www/index.html`.
</code_context>

<specifics>
## Specific Ideas

- Test offline locally by building, running `npm start` on port 3001, loading once, then stopping the server and reloading: the shells must still render from the SW cache.
- Old installed APKs load the new web code unchanged; all native calls stay feature-detected.
</specifics>

<deferred>
## Deferred Ideas

- Locked-screen on-device recording (native PCM capture) - stretch, post-milestone
- Offline first launch (needs a bundled shell) - rejected; documented limitation
- androidx.webkit 1.18 cross-origin-isolation allowlist spike - separate optional spike
- Background Sync API (unsupported in WebView) - sync stays foreground (Phase 2)
- Aurora Ink restyle of pill/notices/download control - Phase 5
</deferred>

---

*Phase: 3-Offline App Shell & Gating*
*Context gathered: 2026-11-21*
