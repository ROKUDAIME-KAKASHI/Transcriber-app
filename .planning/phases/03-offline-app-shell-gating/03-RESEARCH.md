# Phase 3: Offline App Shell & Gating - Research

**Researched:** 2026-11-21
**Domain:** Service worker app shell on a remote (`server.url`) origin, static Next 16 shells, offline auth, connectivity/feature gating, on-device model download/readiness
**Confidence:** HIGH for the build wiring, next-auth behaviour and transformers.js caching (all verified in source or by a throwaway Turbopack build); MEDIUM for WebView runtime behaviour (needs the Xiaomi device test)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Service worker (OFF-01)**
- **D-01:** Service worker on the remote (`server.url`) origin; scope `/`; keep `server.url`, do NOT bundle into the APK. Serve it at the existing `/sw.js` URL so existing registrations upgrade in place and no `Service-Worker-Allowed` header is needed. The current `public/sw.js` (unconditional `skipWaiting` + `clients.claim`, offline.html only) is replaced.
- **D-02:** Implementation choice is a research item for plan-phase (verify against Next 16.2.9 + Turbopack, on Windows, and Vercel): (a) `@serwist/turbopack` + `serwist` 9.5.15, or (b) a hand-written SW fed by a build-time precache manifest (a script run after `next build`, listing the hashed `/_next/static/**` assets, static shell HTML, `/ort/*` wasm, icons, manifest). Prefer whichever works with the stock `npm run build` / Vercel build without webpack; if Serwist is not clearly working, default to (b). Do NOT use Serwist `defaultCache`; routes are explicit.
- **D-03:** Precache: static shell HTML for `/`, `/meetings`, `/meeting`, `/login`, `/offline`; all `/_next/static/**`; `/ort/ort-wasm-simd-threaded.{mjs,wasm}`; icons; `manifest.webmanifest`. Precache requests use real network responses (so COOP/COEP headers survive in cache). Never cache redirects or non-200 responses.
- **D-04:** Navigations: network-first with ~3 s timeout, then the cached shell for that pathname (`/meetings/<id>` and `/meeting` map to the `/meeting` shell; unknown paths fall back to the `/` shell or `/offline`). RSC requests (`RSC: 1` header / `_rsc` param): network-only; on failure `Response.error()` so Next does a full navigation, which the SW answers with the shell. `/api/*` is never intercepted or cached (including `/api/auth/*` and `/api/health`). Cross-origin requests (Hugging Face models) pass through untouched; the SW never caches models (transformers.js `transformers-cache` owns them). Do not enable `experimental.useOffline`.
- **D-05:** Any `Response` the SW builds itself (the `/offline` fallback, rewritten shells) must carry `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `next.config.ts` headers stay. Verify `crossOriginIsolated` is still true on shells served from cache.
- **D-06:** Updates: no automatic `skipWaiting()`. A new SW installs and waits. A small "Update ready" notice offers "Reload to update" (posts `SKIP_WAITING`, then reload) only when not recording; otherwise the update applies on the next launch. The recording flag (`src/lib/recordingFlag.ts`) gates it. Activation purges old caches by version prefix. A `ChunkLoadError` / failed dynamic import when not recording triggers one guarded reload (no loops); while recording it only shows a notice.
- **D-07:** Register only in production (as today). If SW registration fails or is unsupported the app must keep working online exactly as now. The existing `errorPath` page (`mobile/www/index.html`) copy is updated to "Open the app once with internet to set up offline use" with retry (first-ever launch offline is the only unsupported case).

**Static client shells (OFF-01)**
- **D-08:** `/` (Record), `/meetings` and the meeting page become static client shells: no `getUserId()` / `redirect()` / Prisma in the server component, no `force-dynamic`. Data comes from Dexie (`useLiveQuery`) and is refreshed from `/api/meetings*` when reachable (Phase 2 sync already pulls). New static route `/meeting` reads the id from `?id=` (inside `Suspense`; also parses `/meetings/<id>` from `location.pathname` for old links the SW serves from the shell). `/meetings/[id]` stays working online (server redirect or thin client page) so old links and Phase 1/2 deep links keep working. Meeting links in the list point to the static route (`/meeting?id=`).
- **D-09:** The meeting loader: Dexie record first; if absent and reachable, fetch `GET /api/meetings/:id` and render (and store it); if absent and offline, a friendly "Not on this device yet. Open it once online" state. `LocalMeetingView` is the starting point; `MeetingView` already supports `source="local"`.
- **D-10:** Keep the Phase 1 navigation (brand link, back arrow, Android back handler) working with the new routes (back arrow parent `/meetings`).

**Auth offline (OFF-06)**
- **D-11:** New client `AuthGate` wraps the app routes (not `/login`). Rules: `authenticated` renders the app and caches the user (existing `transcriber.lastUserId` in SyncProvider; also cache the email for the sidebar). `loading` renders a neutral skeleton. `unauthenticated` AND server unreachable AND a cached last user exists renders the app as that user (a network error is not a sign-out). `unauthenticated` AND server reachable (health ok) redirects to `/login` (keeps local data; only explicit sign-out clears last user). No cached user and offline shows "Sign in needs internet once" with retry. `SessionProvider refetchWhenOffline={false}`. APIs still enforce auth; a 401 pauses sync (Phase 2 D-08).
- **D-12:** `/login` is a static route; offline it shows a clear one-line message instead of a generic error on submit. Sign-in itself needs internet (accepted).

**Connectivity and Offline pill (OFF-04)**
- **D-13:** Extend `src/lib/connectivity.ts` into a store with a `useConnectivity()` hook (`useSyncExternalStore`): state `online | offline | unknown`. Hints: `online`/`offline` events and `@capacitor/network` (already wired). Truth: `GET /api/health` probe (no-store, 4 s timeout, never touched by the SW) on start, on the `online` event, on visibility/app resume, every ~15-30 s while the tab is visible, and immediately after any failed API fetch (`markUnreachable`). Offline when the probe fails (covers Wi-Fi with no internet); back online as soon as a probe succeeds (probe promptly after the `online` event). A single failed probe while `navigator.onLine` is true is retried once before flipping to offline (avoid flicker). Existing `isReachable()` and Phase 2 sync keep working.
- **D-14:** A small `ConnectivityPill` ("Offline") shows in the AppShell top bar (phone) and sidebar (laptop) only when offline, with `role="status"` / `aria-live="polite"`. Not shown while `unknown` at startup. Disappears when reachable again. Tapping it shows a one-line explainer: what still works offline (on-device recording, saved meetings) and what does not (Cloud recording, AI minutes).

**Feature gating (OFF-05)**
- **D-15:** One `FeatureGate` helper/hook: `useFeatureGate("deepgram" | "ai")` returns `{enabled: boolean, reason: string | null}` (reasons: "Needs internet", "Sign in again to use this"). AI never blocks on sync because Phase 2 D-12 flushes before `/process`. Enabled when reachable and signed-in; auto-enables when connectivity returns (no reload).
- **D-16:** Deepgram: the Cloud engine option on the Record screen is disabled with the one-line reason; if Cloud is the stored/default engine (APK default) and offline, the effective engine for this session is the on-device engine with a note "Offline, using on-device", WITHOUT overwriting the saved preference; when back online and idle the saved choice is honored again. A recording already in progress is never interrupted by connectivity changes.
- **D-17:** AI minutes: the "Generate"/regenerate buttons in MeetingView (and any other AI entry point) are disabled with the reason shown next to them and re-enable automatically. Existing minutes and transcripts stay readable offline.
- **D-18:** Honest on-device offline recording copy: the Record screen says on-device recording works with no internet but the screen must stay on (the WebView/ASR stops when the screen locks); Cloud keeps recording with the screen off but needs internet. Reuse the existing battery/screen-on note pattern; no promise of locked-screen offline recording.

**Download for offline models (OFF-02)**
- **D-19:** A "Download for offline" control on the Record screen (for on-device engines, online only to start) downloads the models the chosen engine needs (preferred model plus its fallback, e.g. Moonshine Base + Tiny; Whisper Base) via the existing `loadSpeechModel` path with a progress bar; sizes from `MODELS[...].sizeMb` are shown ("~90 MB"). It warns about size (mobile data), is cancelable/resumable best-effort, and calls `navigator.storage.persist()`.
- **D-20:** Status per engine: "Not downloaded" / "Downloading n%" / "Ready offline" / error. Readiness is verified against what is actually in Cache Storage (`transformers-cache` entries for the model repo files + ORT wasm), not only a localStorage flag; a flag may cache the result. Offline, selecting an engine whose model is not ready shows "Not ready offline. Download needs internet" and disables Start with that reason; a ready engine records and transcribes with zero network requests (verify no remote fetch is attempted when cached; the transformers.js `env` settings are a research item).
- **D-21:** No automatic large downloads: the existing online first-use behaviour (model downloads when you first record) stays. The explicit control is additive.

### Claude's Discretion
SW source layout and manifest generation script, cache names and versioning, exact timeouts and probe cadence, AuthGate skeleton visuals, pill/notice component details, wording of reasons, how Cache Storage readiness is probed, and test strategy (pure-logic tests with `node --test` for URL routing / manifest / gate logic; the rest verified via `npm run build` + `npm start` on port 3001 and the built-in browser, stopping the server to simulate offline).

### Deferred Ideas (OUT OF SCOPE)
- Locked-screen on-device recording (native PCM capture) - stretch, post-milestone
- Offline first launch (needs a bundled shell) - rejected; documented limitation
- androidx.webkit 1.18 cross-origin-isolation allowlist spike - separate optional spike
- Background Sync API (unsupported in WebView) - sync stays foreground (Phase 2)
- Aurora Ink restyle of pill/notices/download control - Phase 5
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OFF-01 | After one online visit, the app opens with no internet: Record, Meetings list and meeting pages render | Hand-written SW + `compiler.runAfterProductionCompile` manifest generator (verified); static shells in a `(app)` route group; `/meeting?id=` shell; SW routing table; shared-cache precache of 53 chunk files (about 2.8 MB critical) |
| OFF-02 | Record with on-device models with no internet; models downloadable ahead with "ready offline" status | transformers.js 4.3.2 `ModelRegistry.is_pipeline_cached_files` (cache key = HF resolve URL in `transformers-cache`), `pipeline()+dispose()` as the download primitive, cached load makes zero remote requests, ORT wasm readiness check |
| OFF-04 | Offline indicator based on real reachability | Connectivity store + `/api/health` probe design, hysteresis, cadence; Capacitor Network is a hint only (VALIDATED capability can false-negative) |
| OFF-05 | Cloud (Deepgram) and AI minutes only online, disabled with one-line reason | `useFeatureGate` pure function; effective-engine override in `Recorder.tsx`; the single AI button in `MeetingView.tsx` |
| OFF-06 | Signed-in user stays signed in offline | next-auth v4 `useSession` quirks (network error becomes `unauthenticated`, null session sticks); own session probe in `AuthGate`; cached user id + email |
</phase_requirements>

## Summary

**Service worker decision (D-02): use approach (b), a hand-written SW generated inside `next build` by Next's documented `compiler.runAfterProductionCompile` hook. Do not use Serwist.** I verified the hook end to end with a throwaway Next 16.2.9 Turbopack app (built in a sibling folder through a junction to the project's `node_modules`, then deleted): the hook runs after compile and before static generation, `.next/static` is already complete at that moment (all hashed chunks plus the `<buildId>/` manifests), a file it writes to `public/` is served by `next start` with the COOP/COEP headers, and it works with the stock `next build`. Because the hook lives in `next.config.ts`, it also runs on Vercel whatever Build Command the dashboard has, and needs no new npm dependency. Serwist would add `@swc/core`, `esbuild`, `@serwist/build` (workbox globbing), a second zod, serves the SW from `/serwist/sw.js` (not `/sw.js`, conflicting with D-01), and still cannot see the prerendered shell HTML at route-evaluation time, so shells would need `additionalPrecacheEntries` anyway. Note this deviates from the CLAUDE.md STACK table recommendation of `@serwist/turbopack`; D-02 explicitly delegates the choice to this research and says default to (b) if Serwist is not clearly working.

**Static shells:** make `/`, `/meetings`, `/meeting`, `/offline` static by deleting all server-side auth/Prisma from them. Verified in the spike: a client page that calls `useSearchParams()` inside `<Suspense>` prerenders to a static HTML file with `Cache-Control: s-maxage=31536000`, COOP/COEP headers and a `BAILOUT_TO_CLIENT_SIDE_RENDERING` fallback; `/login` is already static in the existing build. A server `redirect()` page for `/meetings/[id]` stays dynamic (`ƒ`) and works. In the browser, Next sets the initial `canonicalUrl` from `location.href` (verified in `create-initial-router-state.js`), so serving the `/meeting` shell at another URL does hydrate with that URL. The safer design is still for the SW to answer an offline `/meetings/<id>` navigation with a synthetic 302 to `/meeting?id=<id>`, so offline and online URLs are identical.

**Three findings that change the plan and are not in CONTEXT/STACK:**
1. `.next/static/media` contains a **26.9 MB `ort-wasm-simd-threaded.asyncify.*.wasm`** plus a 118 KB `ort.webgpu.bundle.min.*.mjs` (WebGPU/JSEP glue pulled in by transformers.js). The worker uses `device: "wasm"` with `wasmPaths` pointing at `/ort/`, so they are never fetched. "Precache all `/_next/static/**`" must **exclude** them (plus `*.map`, `*.ts`), otherwise the install downloads about 30 MB. The real critical precache is about 2.8 MB.
2. **next-auth v4 turns a network error into "unauthenticated" and then sticks there.** `fetchData` swallows fetch errors and returns `null`; `refetchOnWindowFocus` (default true) refetches on every visibility change even with `refetchWhenOffline={false}` (that flag only guards the interval poll); and once `_session === null` the provider never refetches on focus again until reload. `useSession` alone cannot implement D-11. `AuthGate` must run its own `/api/auth/session` probe (distinguish network error vs `{}`), and `signIn()` offline hard-navigates to `/api/auth/error`, so `/login` must gate submit on connectivity.
3. transformers.js 4.3.2 has a first-class cache API: `ModelRegistry.is_pipeline_cached_files("automatic-speech-recognition", repo, {device:"wasm", dtype:"q8"})`. Cache name `transformers-cache`, key = the HF `resolve` URL. A fully cached load makes zero remote requests (`get_file_metadata` checks the cache first), so "Ready offline" can be exact.

**Primary recommendation:** Generate `public/sw.js` from `sw/` templates in `compiler.runAfterProductionCompile`; precache about 2.8 MB (53 filtered chunk files + 5 shell HTMLs + manifest) in a version-independent shared asset cache, keep ORT (14 MB) in a lazy tier, no `skipWaiting`; route SW navigations through a pure, `node --test`-able `sw/routing.js`; build `AuthGate` on its own session probe; add no npm packages.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Offline shell (HTML/JS/CSS/fonts) | Service worker (browser) | CDN/Static (Vercel serves originals) | SW is the only thing that answers when the network is gone |
| Precache manifest generation | Build tooling (`next build` hook) | — | Knows the hashed filenames; runs on Vercel in the stock build |
| Static route shells | Frontend server (prerender at build) | Browser (hydrate from Dexie) | Same HTML for every user; data comes from the client |
| Meeting/list data offline | Browser (Dexie/IndexedDB, Phase 2) | API (refresh when online) | Source of truth on device |
| Auth state offline | Browser (cached user id/email + probe) | API (`/api/auth/session`, JWT cookie) | Cookie remains the real credential; the cache only decides UI |
| Reachability | Browser (`/api/health` probe store) | Capacitor Network (hint only) | Only a real request to our server proves reachability |
| Feature gating (Deepgram, AI) | Browser (pure gate fn + hook) | API (still enforces auth/401) | UI convenience; server stays authoritative |
| Model download + readiness | Browser worker (transformers.js + Cache API) | Hugging Face CDN (cross-origin, untouched by SW) | Library owns cache layout |
| Update orchestration | Browser (`UpdateNotice`, SW messages) | SW (install/waiting/activate) | Needs the recording flag |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | Hand-written service worker, Node `fs`/`crypto`/`path` in the build hook | Zero dependencies, nothing to install on a nearly-full C: drive, no supply-chain surface. `[VERIFIED: spike build, Next 16.2.9]` |
| `next` (existing) | 16.2.9 | `compiler.runAfterProductionCompile` hook, static prerender | Documented in `node_modules/next/dist/docs/03-architecture/nextjs-compiler.md` (Build Lifecycle Hooks); typed in `config-shared.d.ts` `[VERIFIED: node_modules/next/dist/docs]` |
| `@huggingface/transformers` (existing) | 4.3.2 | `ModelRegistry.is_pipeline_cached_files`, `pipeline()` progress | Exports `ModelRegistry` from the package root `[VERIFIED: dist/transformers.web.js L32135, types]` |
| `next-auth` (existing) | 4.24.15 | `/api/auth/session` endpoint, `signIn`/`signOut` | Keep; only the React `useSession` layer is bypassed `[VERIFIED: node_modules/next-auth/react/index.js]` |
| `dexie` / `dexie-react-hooks` (existing) | 4.4.7 / 4.4.0 | Local store | Phase 2 |
| `@capacitor/network` / `@capacitor/app` (existing) | 8.0.1 / 8.1.2 | Connectivity hint, resume event | Already wired |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written SW + hook | `@serwist/turbopack` 9.5.15 | Generates SW at `/serwist/sw.js` via an `app/serwist/[path]/route.ts` (conflicts with D-01 `/sw.js`); pulls `@swc/core`, `esbuild`, `@serwist/build`, zod 4.6, kolorist, browserslist; globs `.next/static` at route-evaluation time but cannot see prerendered HTML (needs `additionalPrecacheEntries`); `@serwist/next` still needs webpack per Next's PWA guide `[VERIFIED: dist tarball + Next docs]`. Not tried at runtime (not installed per the task rules), so this is "heavier and conflicts with D-01", not "broken". |
| `compiler.runAfterProductionCompile` | `"build": "next build && node scripts/build-sw.mjs"` | Works too (Vercel docs: `vercel.json` buildCommand > dashboard > `package.json` build script `[CITED: vercel.com/docs/builds/configure-a-build]`) but breaks if the dashboard overrides Build Command with plain `next build` and no `vercel.json`. The hook has no such failure mode. |
| Hook | `experimental.adapterPath` | Build Adapters API is for deployment platforms (Vercel has its own adapter); out of scope `[VERIFIED: next docs adapterPath.md]` |
| Hook | Static route handler `app/sw.js/route.ts` reading `.next` | Works in principle (static generation runs after compile) but couples the SW to route-handler caching headers and complicates dev; no advantage |

**Installation:** none. Package Legitimacy Audit: no external packages are added by this phase.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | not run (nothing to install) | n/a |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
Serwist (`@serwist/turbopack`, `serwist`) was inspected from its npm tarball in the scratchpad only and is NOT recommended.

## Architecture Patterns

### System Architecture Diagram

```
BUILD TIME (npm run build = next build, local and Vercel)
  next build (Turbopack) --compile--> .next/static/{chunks,media}/*  (content-hashed)
        |
        +--> compiler.runAfterProductionCompile({projectDir, distDir})   [distDir is ABSOLUTE in 16.2.9]
                 |  list .next/static, filter excludes, sha256(public/ort/*), version = hash(list + time)
                 |  inline sw/routing.js + MANIFEST into sw/sw.js template
                 +--> writes public/sw.js (gitignored)
        |
        +--> static generation: /, /meetings, /meeting, /login, /offline -> .next/server/app/*.html

RUNTIME (browser or Capacitor WebView, origin = server.url https)
  Providers (prod only) --register('/sw.js',{scope:'/',updateViaCache:'none'})--> SW
  SW install:  fetch(cache:'reload') every critical URL -> tr-assets (shared, URL-keyed)
                                              shells+manifest -> tr-shell-<version>
               NO skipWaiting.  activate: prune old versions + clients.claim()
  Page load / navigation
     request --> SW fetch handler (routing.js)
        /api/*, cross-origin, non-GET, RSC (rsc header or _rsc) ----> NOT intercepted (browser/network)
        /_next/static/*, /ort/*  ---> cache-first (tr-assets), fall through to network
        navigation  ---> network-first 3 s (and 5xx) ---> else cached shell for the pathname
                           /meetings/<id> -> 302 /meeting?id=<id>   ;  unknown -> /offline shell
  Shell hydrates ---> AuthGate (own /api/auth/session probe + cached user) ---> AppShell + page
       page data: Dexie (useLiveQuery); sync engine (Phase 2) refreshes when reachable
  Connectivity store: events + @capacitor/network (hints) --> /api/health probe (truth) --> useConnectivity()
       --> ConnectivityPill, useFeatureGate('deepgram'|'ai'), Recorder effective engine, OfflineModelControl
  Worker (speech.worker.ts): pipeline() / ModelRegistry --> Cache Storage 'transformers-cache'
       (keys: https://huggingface.co/<repo>/resolve/main/<file>, plus /ort/*.wasm|mjs via useWasmCache)
```

### Recommended Project Structure
```
sw/                           # NOT under src/, never bundled by Next
├── routing.js                # pure URL classification, UMD-lite (module.exports guarded). node --test target
├── manifest.js               # pure: filter/exclude rules, version hash. node --test target
├── sw.template.js            # classic SW; contains /*__ROUTING__*/ and /*__MANIFEST__*/ placeholders
└── build.mjs                 # exports buildServiceWorker({projectDir, distDir}); reads .next/static, public/ort
src/lib/sw/
├── register.ts               # registerServiceWorker(), waiting/update state, SKIP_WAITING, guarded reload
├── chunkError.ts             # ChunkLoadError detection + reload guard (pure core)
src/lib/connectivity.ts       # extended: store + useConnectivity (pure core in connectivityCore.ts)
src/lib/featureGate.ts        # pure gate(kind, {conn, auth}) + useFeatureGate
src/lib/authCore.ts           # pure decideAuth({session, conn, cachedUser, ...})
src/lib/speech/readiness.ts   # engine -> model chain, cache status via worker, ORT check
src/components/{AuthGate,AuthProvider,ConnectivityPill,UpdateNotice,OfflineModelControl}.tsx
src/app/(app)/layout.tsx      # <AuthGate><AppShell>{children}</AppShell></AuthGate>
src/app/(app)/page.tsx, meetings/page.tsx, meeting/page.tsx, meetings/[id]/page.tsx
src/app/offline/page.tsx      # static, outside (app) (no auth gate)
src/app/login/page.tsx        # existing static
```
Moving pages into a `(app)` route group changes no URL and lets the layout hold `AuthGate` + `AppShell` once (today each page wraps `AppShell`, which remounts on every navigation).

### Pattern 1: SW generated in the Next build hook
**What:** `next.config.ts` adds `compiler.runAfterProductionCompile`, which dynamically imports `sw/build.mjs`.
**Critical gotcha (verified):** the hook receives an **absolute** `distDir` in Next 16.2.9 even though the docs say "defaults to `.next`". `path.join(projectDir, distDir)` produced `C:\...\C:\...\.next\static` and failed. Always `path.resolve(projectDir, distDir, "static")`.
```ts
// next.config.ts (add inside nextConfig)
compiler: {
  runAfterProductionCompile: async ({ projectDir, distDir }) => {
    const { buildServiceWorker } = await import("./sw/build.mjs");
    await buildServiceWorker({ projectDir, distDir });
  },
},
```
```js
// sw/build.mjs (sketch). [VERIFIED approach: spike build listed .next/static at hook time]
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { selectPrecache, makeVersion } from "./manifest.js";

export async function buildServiceWorker({ projectDir, distDir }) {
  const dist = path.resolve(projectDir, distDir);
  const staticDir = path.join(dist, "static");
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(staticDir, p).split(path.sep).join("/"));
    }
  })(staticDir);
  const assets = selectPrecache(files);            // chunks/*, media/*.woff2, css; excludes below
  const lazy = ["/ort/ort-wasm-simd-threaded.mjs", "/ort/ort-wasm-simd-threaded.wasm"]
    .filter((u) => fs.existsSync(path.join(projectDir, "public", u)))
    .map((u) => ({ url: u, rev: sha(path.join(projectDir, "public", u)) }));
  const version = makeVersion(assets, lazy, Date.now());   // unique per build, see Pitfall 6
  const manifest = { version, assets: assets.map((f) => `/_next/static/${f}`),
    shells: ["/", "/meetings", "/meeting", "/login", "/offline", "/manifest.webmanifest"], lazy };
  const tpl = fs.readFileSync(path.join(projectDir, "sw", "sw.template.js"), "utf8");
  const routing = fs.readFileSync(path.join(projectDir, "sw", "routing.js"), "utf8");
  fs.writeFileSync(path.join(projectDir, "public", "sw.js"),
    tpl.replace("/*__ROUTING__*/", routing).replace("/*__MANIFEST__*/", `const MANIFEST = ${JSON.stringify(manifest)};`));
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
```
Excludes for `selectPrecache` (verified against the existing `.next/static`): `*.map`, `*.ts` (a 10 KB `speech.worker.*.ts` source asset Turbopack emits and serves as `video/mp2t`, never executed), `media/ort-wasm-simd-threaded.asyncify.*.wasm` (26.9 MB), `media/ort.webgpu.bundle*.mjs`, and the whole `<buildId>/` directory (`_buildManifest.js`, `_ssgManifest.js`, `_clientMiddlewareManifest.js` are Pages-Router artifacts; the prerendered login HTML references only `chunks/` and `media/`). Never add a blanket `/_next/static/**` glob.

### Pattern 2: SW caches and routing (explicit routes, no defaultCache)
- `tr-assets-v1` (shared across SW versions, URL-keyed): all hashed `/_next/static/*` plus lazy `/ort/*`. Hashed names never change content, so a new version only downloads new chunks (`await assets.match(url)` before fetching).
- `tr-shell-<version>`: the 5 shell HTMLs + `manifest.webmanifest`. Mutable URLs, so versioned by cache name and purged on activate.
- Activate: delete `tr-shell-*` other than the current one; prune `tr-assets-v1` keys not in the current manifest (safe, because activation only happens when no old client is alive, or right before the user-triggered reload).
- Install uses `fetch(new Request(url, { cache: "reload" }))`, requires `res.ok && !res.redirected && res.type === "basic"`; any failure rejects install (old SW stays; retry on next update check). Concurrency fine (HTTP/2, about 60 files).
- **Cache lookups:** `cache.match(key, { ignoreVary: true, ignoreSearch: true })`. The prerendered HTML has `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` `[VERIFIED: curl on next start]`; never put an RSC response in the shell cache.
- Pure `route(pathname, request-ish)` returns one of `{kind:"pass"}`, `{kind:"asset"}`, `{kind:"nav", shell}`, `{kind:"redirect", to}`; this is what `node --test` covers.
  - pass (no `respondWith`): non-GET, cross-origin, `/api/*` (the icon exception is not needed; do not intercept icons), requests with an `rsc` header, `Next-Router-Prefetch`/`Next-Router-Segment-Prefetch` headers, or `_rsc` search param. **Recommendation: do not intercept RSC at all** instead of `Response.error()`: Next catches the fetch rejection and falls back to a hard navigation either way (`fetch-server-response.js` catch returns `originalUrl`, verified), and not intercepting keeps the SW out of the RSC path. If "lie-fi" hangs, optionally race RSC against a 5 s timeout returning `Response.error()`.
  - asset: `/_next/static/*` and `/ort/*` cache-first; on a miss fetch from network and put (only 200 basic).
  - nav (`request.mode === "navigate"`, same-origin, GET): `Promise.race([fetch(request), 3 s timeout])`; on reject, timeout or `status >= 500` use the cached shell. `shellFor`: `/` -> `/`; `/meetings` -> `/meetings`; `/meeting` -> `/meeting`; `/login` -> `/login`; `/offline` -> `/offline`; `/meetings/<id>` (single segment) -> redirect to `/meeting?id=<id>`; trailing slash stripped first; everything else -> `/offline` (not the `/` shell: serving Record at an unknown URL is confusing).
- Synthetic responses (`/offline` fallback is just the cached `/offline` shell, so it already has the headers). The only synthetic responses are the 302 (`new Response(null, {status: 302, headers: {Location, "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}})`) and a last-resort inline "You're offline" HTML with the same two headers (use only if the shell cache is empty). `Response.redirect()` headers are immutable, so use the constructor.

### Pattern 3: Static shells and the meeting loader
- `src/app/(app)/page.tsx` -> `export default function RecordPage() { return <Recorder />; }` (no `getUserId`, no `redirect`, no `dynamic`). Same for `meetings/page.tsx` (`<MeetingList />` with no server rows) and a new `meeting/page.tsx`.
- `meeting/page.tsx`: `"use client"` or a server wrapper rendering `<Suspense fallback={<MeetingSkeleton/>}><MeetingLoader/></Suspense>` where `MeetingLoader` uses `useSearchParams()` (verified to prerender statically with the fallback) and `usePathname()`: `id = params.get("id") ?? /^\/meetings\/([^/]+)\/?$/.exec(pathname)?.[1]`, validated against `MEETING_ID_RE` before any fetch (`encodeURIComponent` when building the URL).
- `meetings/[id]/page.tsx` -> server component: `if (!MEETING_ID_RE.test(id)) notFound(); redirect(`/meeting?id=${id}`)`. Verified in the spike: it stays dynamic and returns 307 with `Location: /meeting?id=abc`, still carrying COOP/COEP. Online old links and SW-network-first navigations just follow it.
- Loader order (D-09): Dexie record first. Treat `meeting.hasTranscript === false` (meta-only rows from `applyPull`, `refetch` pending) as absent. Else if reachable: `GET /api/meetings/:id` -> `{ meeting }` with a raw JSON `transcript`, so call `parseTranscript(meeting.transcript)` (the old server page did) -> `cacheServerMeeting(userId, ...)` -> render. Else "Not on this device yet" state. Render `<MeetingView key={id} .../>`: `MeetingView` seeds `useState` from props and will not update when props change, so always key by id and only mount it once data is final.
- `MeetingList` currently takes server rows as the base and **drops non-pending local rows** (`l.pending !== 1` filter), so with `meetings={[]}` every synced meeting would vanish. Refactor to use all non-deleted Dexie rows as the base (`listMeetings(userId)` returns every non-deleted row, including pulled ones) and show a skeleton until the Dexie live query has resolved. On the very first visit, show a loading state until the first pull finishes (use `getSyncSnapshot()`), not "No meetings yet".

### Pattern 4: AuthGate on its own session probe
```ts
// authCore.ts (pure, node --test-able)
export type Probe = "ok-user" | "ok-empty" | "unreachable";   // 200+user | 200+{} | throw/timeout/5xx/non-JSON
export function decideAuth(i: { probe: Probe | "pending"; cached: {id:string; email:string} | null; waitedMs: number }) {
  if (i.probe === "pending") return i.waitedMs > 6000 && i.cached ? "app-cached" : "skeleton";
  if (i.probe === "ok-user") return "app";
  if (i.probe === "ok-empty") return "redirect-login";             // server answered: really signed out
  return i.cached ? "app-cached" : "needs-internet";               // unreachable
}
```
- Probe = `fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(6000) })`; `res.ok` and `await res.json()`; `Object.keys(json).length > 0` means signed in; `{}` means signed out; any throw or non-JSON (captive portal HTML) means unreachable. Re-run on `useConnectivity()` offline->online, on resume, and from the "Try again" button.
- Cache `{id, email}` on every `ok-user` (`transcriber.lastUserId` stays for `SyncProvider`; add `transcriber.lastUserEmail`); `markSignedOut()` clears both. Never store a token: the httpOnly JWT cookie remains the credential.
- Replace the two `useSession()` consumers (`AppShell` for email, `SyncProvider` for `status`/`userId`) with an `AuthProvider` context exposing `{status, user}`; drop `SessionProvider` from `Providers` (keep `signIn`/`signOut` imports; they work without the provider). If it is kept, it must be `refetchOnWindowFocus={false} refetchWhenOffline={false}` and its `status` must not drive UI.
- `redirect-login`: `router.replace("/login")` while still rendering the skeleton (no flash). Do NOT clear `lastUserId` (local data survives, Phase 2 D-08).
- `/login` offline: disable submit while `useConnectivity() !== "online"` and show the UI-SPEC line. Also pre-probe `/api/health` in `submit` before calling `signIn`, because next-auth `signIn` does `getProviders()` first and on failure sets `window.location.href = "/api/auth/error"` (verified in `react/index.js`), a hard navigation to a dead page.
- Sign-out offline: `signOut` cannot clear the httpOnly cookie without the server. Disable the sign-out button (or explain) while offline; call `markSignedOut()` only when it will succeed, otherwise the next online load is signed in but the cached user was cleared.

### Pattern 5: Connectivity store
- `connectivityCore.ts` (pure): `reduce(state, event)` for events `hint-online`, `hint-offline`, `probe-ok`, `probe-fail`, with the rule "first `probe-fail` while `navigator.onLine === true` schedules one retry after about 1.5 s; offline only after the second consecutive failure; `navigator.onLine === false` flips to offline immediately; any `probe-ok` flips to online".
- Hints that must NOT flip state by themselves: the Capacitor `networkStatusChange {connected:false}` handler. Android sets `connected = NET_CAPABILITY_VALIDATED && NET_CAPABILITY_INTERNET` `[VERIFIED: @capacitor/network Network.java L80-82]`; VALIDATED comes from Google's connectivity check, which can be false on filtered Indian networks while our server is reachable. Treat a plugin `connected:false` as "probe now"; only `navigator.onLine === false` is trusted as an instant offline.
- Cadence: probe on start, `online`/`offline` events, `visibilitychange` to visible, Capacitor `appStateChange` active, and after `markUnreachable()`; periodic every 30 s while online and visible, every 10 s while offline or unknown and visible (offline probes fail fast and cost nothing). Timeout 4 s (existing). `useSyncExternalStore` with `getServerSnapshot = () => "unknown"` so the prerendered shell hydrates without mismatch. Keep exporting `isReachable`, `markUnreachable`, `onConnectivityHint` unchanged for Phase 2 sync.
- The probe must not be intercepted by the SW (`/api/*` pass-through) and already has `Cache-Control: no-store` and returns 204 without touching the database `[VERIFIED: route.ts + curl]`.

### Pattern 6: Feature gate
```ts
// featureGate.ts (pure)
export type Gate = { enabled: boolean; reason: "Needs internet" | "Sign in again to use this" | null };
export function gate(_kind: "deepgram" | "ai", s: { conn: "online" | "offline" | "unknown"; auth: "app" | "app-cached" | "other" | "needs-reauth" }): Gate {
  if (s.auth === "needs-reauth") return { enabled: false, reason: "Sign in again to use this" };
  if (s.conn === "offline") return { enabled: false, reason: "Needs internet" };
  return { enabled: true, reason: null };   // unknown at startup: do not disable (avoid a flash of disabled UI)
}
```
- `Recorder.tsx`: `effectiveEngine = (!locked && engine === "deepgram" && !deepgramGate.enabled) ? lastOnDevice : engine` where `lastOnDevice` comes from a new `transcriber.lastOnDeviceEngine` key (default `moonshine`), and **pass `effectiveEngine`, not `engine`, to `useRecorder`, `nativeMode`, the OptionList value and the copy**. `nativeMode = inApp && (effectiveEngine === "deepgram" || ...)` must use it too, otherwise the APK still starts the native Deepgram recorder offline. Never `remember(ENGINE_KEY, ...)` for the override. `locked` (busy/starting) freezes it so an in-progress recording is never switched.
- `OptionList` has no per-option disabled today (it has a group `disabled`): add an optional `disabled?: boolean` and `description` override per option in `ui.tsx`.
- `MeetingView.tsx` has exactly one AI entry point (the `Create/Regenerate` Button at the "AI document" panel, `disabled={!hasTranscript}`): change to `disabled={!hasTranscript || !aiGate.enabled}` plus the `GateReason` line. `generate()` already flushes the outbox first (Phase 2 D-12), so no sync gating is needed.

### Pattern 7: Update flow
- Registration (production only; also in dev actively unregister, see Pitfall 4): `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })` after `window.load`.
- State: if `reg.waiting && navigator.serviceWorker.controller` -> "update ready". Listen to `reg.addEventListener("updatefound")` -> `installing.statechange === "installed"` -> same. First install (no controller) must not show the notice.
- "Reload to update": `await isRecordingActive()` must be false, then `reg.waiting.postMessage({type:"SKIP_WAITING"})`; on a `controllerchange` listener registered **once** do `location.reload()`, guarded by a `sessionStorage` flag so it cannot loop.
- Call `reg.update()` on resume and on connectivity offline->online (cheap, SW script is always revalidated).
- Existing installs: the old `/sw.js` (unconditional skipWaiting) is replaced at the same URL; the new SW installs and waits, so existing users see the notice once (acceptable, intended). A waiting SW activates when all controlled clients are gone; in the APK that means a cold start after the process dies, not merely backgrounding (matches "applies on the next launch").
- ChunkLoadError: Turbopack throws `Error("Failed to load chunk ...")` with `name = "ChunkLoadError"` `[VERIFIED: turbopack runtime chunk]`. Detect on `window` `error` and `unhandledrejection` using `name === "ChunkLoadError"` or `/Failed to load chunk|Loading chunk .* failed|Failed to fetch dynamically imported module/`. Pure `shouldReloadForChunkError({recording, lastReloadAt, now})` allows one reload per 60 s via `sessionStorage`; while recording only set the "Update needed" notice state.

### Pattern 8: Model download and readiness (worker owns it)
Add two messages to `speech.worker.ts` and two functions to `client.ts` (do not reuse `loadSpeechModel`: it keeps models resident and holds a single module-level `progressListener`):
```ts
// worker: readiness (no network when cached; throws or returns false if not)
import { ModelRegistry } from "@huggingface/transformers";
const r = await ModelRegistry.is_pipeline_cached_files("automatic-speech-recognition", MODELS[name].repo, { device: "wasm", dtype: "q8" });
self.postMessage({ type: "cache-status", model: name, cached: r.allCached, files: r.files });   // wrap in try/catch -> cached:false

// worker: download = what the library does anyway, then free memory
const t = await pipeline("automatic-speech-recognition", repo, { device: "wasm", dtype: "q8", progress_callback });  // same options as loadModel
await t.dispose?.();
```
- File set the q8 pipeline needs (derived from `get_model_files`, config-driven, no network when `config.json` is cached): `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`. All three repos contain every one of those `[VERIFIED: HF tree API]`, so there are no non-cacheable 404 optional files (a 404 is never cached and would be re-requested on every load, which would break an offline load).
- Cache name `transformers-cache`; key = `https://huggingface.co/<repo>/resolve/main/<file>`; `env.useBrowserCache` default true in browsers `[VERIFIED: dist L141-146, L7448-7470]`. `cache.match` honours `Vary`; the lib's own behaviour already works today.
- Cached load = zero remote requests: `loadResourceFile` returns on a cache hit before any fetch; `get_file_metadata` (used for progress totals) checks the cache first (`fromCache: true`); tokenizer/processor file lists use `get_file_metadata` on cached `tokenizer_config.json` / `preprocessor_config.json`. Uncached + offline: `getFile(remoteURL)` rejects (TypeError), not a clean "not found". So gate on readiness first and, when offline, pass `local_files_only: true` to `pipeline()` for a fast clean failure instead of a hung fetch.
- ORT wasm: the worker's `wasmPaths` object plus the default `env.useWasmCache` makes transformers.js itself fetch `/ort/ort-wasm-simd-threaded.wasm` (14.3 MB) and `.mjs` (24 KB) and `cache.put` them in `transformers-cache` under the absolute URL on first model load `[VERIFIED: dist L8523-8560, L8650-8700]`. So running the download flow (which instantiates the pipeline) already caches ORT. Readiness for ORT = `await caches.match(absoluteUrl("/ort/ort-wasm-simd-threaded.wasm"))` (searches every cache, so the SW copy also counts). Leave `env.useWasmCache` at its default (changing it alters how the wasm is loaded: `wasmBinary` vs `instantiateStreaming`).
- Engine readiness: `chain(engine) = [preferredModel(engine), MODELS[..].fallback]` (Moonshine: base then tiny; Whisper: `whisper-base`). Start-gate (offline) needs `cached(preferred) && ortCached`; the "Ready offline" badge needs the whole chain.
- Progress: existing `progress_total` events (`info.progress` 0-100, whole-percent throttle already in `loadModel`); drive the 250 ms UI throttle from the main thread. For a two-model download, map `(i + pct/100) / n`.
- Cancel: there is no abort in `pipeline()`; cancel = `worker.terminate()` plus resetting `client.ts` state (`worker=null; ready=null; readyFor=""`). Each file is put in the cache only when complete, so "Resuming skips what is already saved" holds (best-effort).
- Real sizes (HF tree, q8): moonshine-base about 67 MB (registry says 63), moonshine-tiny about 32 MB (28), whisper-base about 82 MB (77). Tokenizer files add 4-5 MB each. Update `MODELS[...].sizeMb` or add a `+tokenizer` allowance so the label ("about 100 MB" for Moonshine Base + Tiny, not 90) is honest.
- Disable the control while recording or while the speech worker is busy; call `navigator.storage.persist()` (existing `requestPersist` in `local/repo`) when entering Ready. Re-check readiness on mount and on app resume (Android can evict best-effort storage); a localStorage flag may only cache the last answer.

### Anti-Patterns to Avoid
- **Blanket `/_next/static/**` precache:** drags in 27 MB of unused WebGPU wasm. Use the exclude list.
- **`useSession().status === "unauthenticated"` as the sign-out signal:** it is also what a network error yields (Pattern 4).
- **Caching or `Response.error()`-ing RSC requests, or caching any `/api/*`.**
- **Serving the `/` shell for unknown paths** (hydrates Record at a foreign URL): use `/offline`.
- **Auto `skipWaiting`/`clients.claim()` on update** (swaps chunks under a live recording).
- **Writing `public/sw.js` from a script that only runs on a custom Build Command** (fragile on Vercel): use the Next hook.
- **`path.join(projectDir, distDir)` in the hook** (distDir is absolute).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this model cached?" | Manual `caches.open` + guessed file list | `ModelRegistry.is_pipeline_cached_files` | Library derives the exact file list (dtype suffix, external data) and cache keys |
| Model download with progress | Custom fetch+put loop into `transformers-cache` | `pipeline()` + `progress_total` + `dispose()` | Library caches in its own format and handles redirects/streams |
| Connectivity truth | Trusting `navigator.onLine` or `@capacitor/network` alone | Probe `/api/health` (existing) behind a small pure reducer | Wi-Fi with no internet, captive portals, VALIDATED false-negatives |
| Session state offline | Patching `SessionProvider` internals | Own 15-line `/api/auth/session` probe + `decideAuth` | next-auth's client cannot tell network error from signed-out |
| Precache hashing | Reading Turbopack manifests (`build-manifest.json` lists only 9 files; worker chunks are loaded by `importScripts` and not listed) | List `.next/static` on disk | The only complete source; verified at hook time |
| Update UX state machine | Ad-hoc listeners everywhere | One `register.ts` module + the pure reload-guard function | Loop guard and recording gate in one place |

**Key insight:** the deceptive parts are (1) what is *in* `.next/static` (a 27 MB asset nobody loads), (2) what next-auth reports when the network is down, and (3) how much transformers.js already does (cache API, readiness, wasm caching). Build almost nothing new there.

## Runtime State Inventory

> Not a rename/refactor phase, but it replaces an installed service worker, so the relevant runtime state is listed.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Cache Storage `transcriber-shell-v1` (old SW) in every existing install; Dexie DBs and `transcriber.*` localStorage keys (kept) | New SW deletes `transcriber-shell-*` on activate; add `transcriber.lastUserEmail`, `transcriber.lastOnDeviceEngine`; no Dexie schema change |
| Live service config | Vercel Build Command/dashboard unknown; no `vercel.json`, no `.vercel/` in repo | Optional: add `vercel.json` `{"buildCommand":"npm run build"}` as belt and braces (not required by the hook design) |
| OS-registered state | Existing SW registration for scope `/` on every device that opened the app (old `/sw.js`) | Replaced in place by the new `/sw.js` (D-01); waits instead of activating; users see "Update ready" once |
| Secrets/env vars | None | None |
| Build artifacts | `public/sw.js` becomes generated: untrack and gitignore it; `public/offline.html` is obsolete (the old SW referenced it, the new one uses the `/offline` route); `mobile/www/index.html` ships inside the APK | `git rm public/sw.js public/offline.html`; add `public/sw.js` to `.gitignore`; `mobile/www` copy change only reaches newly built APKs (`npx cap sync`), old APKs keep the old text |

## Common Pitfalls

### Pitfall 1: The 27 MB unused wasm in `.next/static`
**What goes wrong:** precaching "all `/_next/static/**`" downloads about 30 MB on install (and fails the install on a flaky link).
**Why:** transformers.js statically imports `onnxruntime-web/webgpu`; Turbopack emits `ort-wasm-simd-threaded.asyncify.<hash>.wasm` and `ort.webgpu.bundle.min.<hash>.mjs` as assets. Worker uses `device:"wasm"` + `/ort/` paths so they are never fetched.
**Avoid:** exclude list in `selectPrecache`; a `node --test` that asserts no `.wasm`/`.map`/`.ts` and total critical size under 5 MB for a fixture.
**Warning signs:** SW install takes long; Cache Storage shows an 27 MB entry.

### Pitfall 2: next-auth offline false sign-out
**What goes wrong:** offline cold start or a visibility refetch yields `unauthenticated`; `AuthGate` redirects to `/login` or the sync engine drops the user.
**Why:** see Summary finding 2. Also after a failed refetch `useSession` stays `unauthenticated` forever (until reload) even when the network returns.
**Avoid:** Pattern 4; set `refetchOnWindowFocus={false}` if the provider is kept.

### Pitfall 3: `distDir` is absolute in the hook
**What goes wrong:** build fails with `ENOENT ...\C:\...\.next\static` on Windows. **Avoid:** `path.resolve`. `[VERIFIED: spike]`

### Pitfall 4: Dev and prod share origin `localhost:3001`
**What goes wrong:** `npm start` (SW registered) and `npm run dev` both use port 3001, so a SW from a production test keeps serving stale shells/chunks to the dev server. **Avoid:** in non-production, `navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))` and `caches.keys()` cleanup in `Providers`.

### Pitfall 5: Redirected or non-basic responses in the shell cache
**What goes wrong:** `respondWith` of a response with `redirected === true` to a navigation (redirect mode `manual`) is a network error; caching a 307 makes the app unusable offline. **Avoid:** install guard (`ok && !redirected && type==="basic"`); shells are now static so `/` no longer redirects server-side (previously it did when signed out).

### Pitfall 6: SW version identical across builds
**What goes wrong:** a change that only affects server-rendered markup (layout metadata, `/offline` text) changes the HTML but not any client chunk name, so a version derived only from chunk names would not update the SW and users keep stale shells. **Avoid:** version includes a build timestamp (`makeVersion(..., Date.now())`). Cost: every deploy triggers one "Update ready" notice and one re-fetch of the 5 small HTML shells (hashed chunks are reused from the shared cache). Accepted.

### Pitfall 7: Stale shell HTML vs fresh API/RSC after a deploy
**What goes wrong:** old precached shell plus new server. **Avoid:** navigations are network-first (online users always get fresh HTML); Next's own `fetch-server-response` does a hard navigation when the flight response build id differs from the client's (`getNavigationBuildId` mismatch, verified); keep the sync/API protocol additive.

### Pitfall 8: Sizes and the "Ready offline" over-promise
**What goes wrong:** UI says about 90 MB, the real download is about 99 MB (tokenizers not in `sizeMb`); readiness reported true when only some files are cached. **Avoid:** use `is_pipeline_cached_files` (all files), correct the size label.

### Pitfall 9: `Link` prefetch and RSC while offline
**What goes wrong:** console noise and, on "lie-fi", slow hard-navigation fallback (the RSC fetch hangs until the network times out before Next falls back). **Avoid:** optional 5 s RSC timeout in the SW; hide/disable nav only if needed; the pill already tells the user.

### Pitfall 10: Hydration of the Record page offline
**What goes wrong:** `Recorder` reads `localStorage`, `navigator`, `isNativeApp()` only in effects already; new code (AuthGate cached user, `useConnectivity`) must not read browser state during render, or the prerendered HTML will mismatch. **Avoid:** `getServerSnapshot` returns `unknown`/null; read caches in `useEffect`.

### Pitfall 11: Back navigation and active tab with `/meeting`
`parentOf("/meeting")` must return `/meetings` (current code only handles `/meetings/` prefixes); `isActive("/meeting", "/meetings")` is false today because `startsWith("/meetings")` does not match `/meeting`; `NavTracker` records pathname only, so `/meeting?id=A` to `/meeting?id=B` is one stack entry (rare; document).

## Code Examples

### SW skeleton (`sw/sw.template.js`)
```js
/*__ROUTING__*/            // defines route(), shellFor(), isRscRequest()
/*__MANIFEST__*/           // const MANIFEST = { version, assets, shells, lazy }
const ASSETS = "tr-assets-v1";
const SHELL = "tr-shell-" + MANIFEST.version;
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

self.addEventListener("install", (e) => e.waitUntil((async () => {
  const assets = await caches.open(ASSETS), shell = await caches.open(SHELL);
  const get = async (url) => {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (!res.ok || res.redirected || res.type !== "basic") throw new Error("precache " + url + " " + res.status);
    return res;
  };
  await Promise.all(MANIFEST.assets.map(async (u) => { if (!(await assets.match(u))) await assets.put(u, await get(u)); }));
  await Promise.all(MANIFEST.shells.map(async (u) => shell.put(u, await get(u))));
  // NO self.skipWaiting() here (D-06)
})()));

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("tr-shell-") && k !== SHELL) await caches.delete(k);
  if (await caches.has("transcriber-shell-v1")) await caches.delete("transcriber-shell-v1");
  const assets = await caches.open(ASSETS), keep = new Set([...MANIFEST.assets, ...MANIFEST.lazy.map((l) => l.url)]);
  for (const r of await assets.keys()) { const p = new URL(r.url).pathname; if (!keep.has(p)) await assets.delete(r); }
  await self.clients.claim();
})()));

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data && e.data.type === "WARM_LAZY") e.waitUntil(warmLazy());
});

self.addEventListener("fetch", (event) => {
  const act = route(new URL(event.request.url), event.request, self.location.origin);
  if (act.kind === "pass") return;                           // browser handles it
  if (act.kind === "asset") return event.respondWith(cacheFirst(event.request));
  if (act.kind === "nav")   return event.respondWith(navigate(event.request, act));
});
// navigate(): Promise.race([fetch(req), timeout(3000)]); if reject/timeout/status>=500 => redirect (302 + ISOLATION)
//   or caches.open(SHELL).then(c => c.match(act.shell, { ignoreVary: true, ignoreSearch: true })) or inline fallback.
```
The lazy tier (`/ort/*`) is fetched on a `WARM_LAZY` message the page sends after the SW controls it (skip when `navigator.connection?.type === "cellular"` or `saveData`), and by the Download control; `/ort/*` is also served cache-first so the first model load online fills it. This keeps D-03's intent (ORT available offline) without 14 MB blocking the install or hitting cloud-only users on mobile data; if the user insists on literal precache, move `lazy` into `assets` (cost: 14 MB on first install, install fails if that fetch fails).

### Routing function sketch (`sw/routing.js`, runs in SW and in `node --test`)
```js
function shellFor(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/" || p === "/meetings" || p === "/meeting" || p === "/login" || p === "/offline") return { shell: p };
  const m = /^\/meetings\/([A-Za-z0-9_-]{1,64})$/.exec(p);          // keep in sync with MEETING_ID_RE
  if (m) return { redirect: "/meeting?id=" + m[1] };
  return { shell: "/offline" };
}
function route(url, req, origin) {
  if (url.origin !== origin || req.method !== "GET") return { kind: "pass" };
  if (url.pathname.startsWith("/api/")) return { kind: "pass" };
  if (req.headers.get("rsc") || url.searchParams.has("_rsc") || req.headers.get("next-router-prefetch")) return { kind: "pass" };
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/ort/")) return { kind: "asset" };
  if (req.mode === "navigate") return Object.assign({ kind: "nav" }, shellFor(url.pathname));
  return { kind: "pass" };
}
if (typeof module !== "undefined") module.exports = { shellFor, route };
```
Check `MEETING_ID_RE` in `src/lib/meetingSelect.ts` and mirror it exactly (keep one regex string shared via a test that compares them).

### Registration and update (client)
```ts
// register.ts
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (process.env.NODE_ENV !== "production") { (await navigator.serviceWorker.getRegistrations()).forEach((r) => void r.unregister()); return null; }
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); } catch { return null; }
}
export function applyUpdate(reg: ServiceWorkerRegistration) {
  if (sessionStorage.getItem("sw.reloading")) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => { sessionStorage.setItem("sw.reloading", "1"); location.reload(); }, { once: true });
  reg.waiting?.postMessage({ type: "SKIP_WAITING" });
}
```
Clear `sw.reloading` on the next successful load (after 10 s) so it cannot block a later update.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next-pwa` / `@serwist/next` needs webpack | Next 16 default Turbopack; documented `compiler.runAfterProductionCompile` | Next 16 | Hook-generated SW works with Turbopack, no plugin |
| transformers.js 3.x: hand-checking `caches` | 4.x `ModelRegistry` (`is_pipeline_cached_files`, `get_pipeline_files`, `clear_cache`) | 4.x | Exact readiness without guessing |
| Per-id dynamic meeting page | Static `/meeting?id=` shell + client data | this phase | Offline-capable, one HTML for all users |

**Deprecated/outdated:** `public/offline.html` plus unconditional `skipWaiting` SW; `getUserId()`+`redirect()` in page server components.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel includes `public/` files written during `next build` (here inside the compile hook, even earlier than a postbuild script) in the deployment. Evidence: Vercel build logs show "Collected static files (public/, static/, .next/static)" after a postbuild step, and next-sitemap's postbuild-to-`public/` pattern works on Vercel; not tested on this project's Vercel | Pattern 1 | No `/sw.js` in production (404) -> old SW stays, app keeps working online; verify on a preview deploy by the user (Claude must not deploy) |
| A2 | A synthetic `new Response(null, {status: 302, headers})` returned for a navigation request is followed by the browser, including in Android WebView | Pattern 2 | Offline `/meetings/<id>` would fail; fall back to serving the `/meeting` shell directly (Next hydrates with `location.href`, verified in source) |
| A3 | `cache.match(..., {ignoreVary:true})` is honoured in Android WebView (Chromium) | Pattern 2 | Cached HTML not matched; fix by storing under a synthetic `Request` without Vary-relevant headers |
| A4 | Android WebView (with Capacitor's ServiceWorkerClient and `server.url` https) registers the SW and serves navigations from it on a cold start with airplane mode (STACK.md rated this HIGH from source, "still needs a device test") | Whole phase | Offline cold start shows the `errorPath` page; device test is the first plan gate |
| A5 | `navigator.connection.type` exists in the WebView for the "skip lazy warm on cellular" heuristic | Code Examples | Heuristic ignored; lazy warm always runs (14 MB) |
| A6 | D-03 literal "precache `/ort/*`" can be satisfied by a lazy tier plus the Download control (deviation from the letter of D-03) | Code Examples | If the user wants literal precache, move `lazy` into `assets`; needs user confirmation |
| A7 | One "Update ready" notice per deploy (timestamped version) is acceptable | Pitfall 6 | Could be tuned later by hashing HTML after build; not possible inside the compile hook |
| A8 | Real q8 model sizes (HF tree API) are 67 / 32 / 82 MB incl. tokenizers; UI-SPEC's "about 90 MB" should read about 100 MB | Pattern 8 | Copy/size mismatch; cosmetic |
| A9 | Hydrating the `/meeting` shell at a different URL works (verified in source for `canonicalUrl`; not run in a browser) | Pattern 3 | Avoided by the 302 design |

## Open Questions (RESOLVED: Q1 ORT lazy tier chosen; Q2 deferred to HUMAN-UAT item 1; Q3 handled in plan 01; Q4 UI detail)

1. **ORT precache tier (D-03).** Literal precache costs 14.3 MB on every first install, including cloud-only APK users, and duplicates the copy transformers.js already makes in `transformers-cache`. Recommendation: lazy tier (above). Needs a yes/no from the user; planner should implement the lazy tier unless told otherwise.
2. **Vercel pickup of the generated `public/sw.js`** (A1) can only be verified on a deploy; ask the user to check `https://<app>/sw.js` after the next deploy, or add `vercel.json` as belt and braces.
3. **Exact `MEETING_ID_RE`** must be mirrored in `sw/routing.js` (read `src/lib/meetingSelect.ts` when planning); add a test asserting they match.
4. **First-ever pull on `/meetings`:** decide the loading/empty wording while Phase 2's first pull is in flight (use `getSyncSnapshot`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build hook, tests | yes | 24.19.0 (runs `.ts` tests natively) | — |
| npm | scripts | yes | 11.13.0 | — |
| Next 16.2.9 + Turbopack | static shells, hook | yes | verified by throwaway build | — |
| adb | device checks (`chrome://inspect`) | yes | 1.0.41 at `C:\platform-tools` | — |
| Android phone (Xiaomi) | WebView SW, airplane-mode cold start, `crossOriginIsolated` | user-owned | — | manual user test; cannot be automated here |
| Vercel preview | verify generated `public/sw.js` served | user-only (no deploys by Claude) | — | local `npm start` proves everything except the Vercel pickup |
| Port 3001 free | `npm start` offline simulation | — | — | stop dev server first (dev and prod share the origin, Pitfall 4) |

**Missing dependencies with no fallback:** none for planning. Device verification is a manual checkpoint.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, but the orchestrator asked for this analysis explicitly, so it is included compactly.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` on Node 24 (runs `.ts` directly; existing `tests/syncCore.test.ts`) |
| Config file | none |
| Quick run command | `node --test "tests/*.test.ts"` (Node 24 expands globs; update the `test` script, today it names a single file) |
| Full suite command | `npm test && npm run typecheck && npm run build` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OFF-01 | `shellFor`/`route` table (shells, `/meetings/<id>` -> redirect, `/api` pass, RSC pass, unknown -> `/offline`, trailing slash) | unit | `node --test tests/swRouting.test.ts` | Wave 0 |
| OFF-01 | `selectPrecache` exclusions (no `.map`, `.ts`, asyncify wasm, webgpu mjs, `<buildId>/`), `makeVersion` changes per build | unit | `node --test tests/swManifest.test.ts` | Wave 0 |
| OFF-01 | After `npm run build`: `public/sw.js` exists, contains every `.next/static/chunks/*.js` of the build and no `asyncify`; shells prerendered (`.next/server/app/{index,meetings,meeting,login,offline}.html`); shells identical with and without a cookie | build smoke script | `node scripts/check-build.mjs` | Wave 0 |
| OFF-01 | Offline render from cache: `npm start -p 3001`, load `/`, `/meetings`, `/meeting?id=x` once, stop server, reload each | manual in built-in browser | — | manual |
| OFF-01 | `crossOriginIsolated === true` on a cache-served shell | manual (console) | — | manual |
| OFF-02 | readiness: engine -> model chain, status mapping (cached/partial/none), size label rounding | unit | `node --test tests/readiness.test.ts` | Wave 0 |
| OFF-02 | cached model loads with zero remote requests (DevTools network offline) | manual / device | — | manual |
| OFF-04 | connectivity reducer: onLine false = instant offline, single fail retried, ok flips online, Capacitor hint only triggers probe | unit | `node --test tests/connectivityCore.test.ts` | Wave 0 |
| OFF-05 | `gate()` truth table; effective-engine selection (`locked` never switches, saved preference untouched) | unit | `node --test tests/featureGate.test.ts` | Wave 0 |
| OFF-06 | `decideAuth` table (probe x cached x waited), including "unreachable + cached = app" and "ok-empty = login" | unit | `node --test tests/authCore.test.ts` | Wave 0 |
| D-06 | chunk-error reload guard (`recording`, `lastReloadAt`), update-allowed predicate | unit | `node --test tests/swUpdate.test.ts` | Wave 0 |

Device-only: cold start in airplane mode shows the shell (not `errorPath`); SW registers in the WebView (`chrome://inspect` Application tab); Android back with new routes; update notice after a second build; storage persistence and model eviction recheck; `crossOriginIsolated` and `hardwareConcurrency` in the APK; recording survives an update notice.

### Sampling Rate
- **Per task commit:** `node --test "tests/*.test.ts"` and `npm run typecheck`
- **Per wave merge:** `npm run build` then `node scripts/check-build.mjs`
- **Phase gate:** full suite green plus the manual offline checklist before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/swRouting.test.ts`, `tests/swManifest.test.ts`, `tests/readiness.test.ts`, `tests/connectivityCore.test.ts`, `tests/featureGate.test.ts`, `tests/authCore.test.ts`, `tests/swUpdate.test.ts`
- [ ] `scripts/check-build.mjs` (post-build assertions; also usable on CI)
- [ ] `package.json` `test` script glob; `sw/routing.js` + `sw/manifest.js` as CommonJS (`module.exports` guard) so both the SW inliner and tests can load them. Import them from the `.ts` tests with a default import (`import routing from "../sw/routing.js"`).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Sign-in stays online-only (next-auth credentials); offline never grants anything new |
| V3 Session Management | yes | JWT httpOnly cookie remains the credential; cached `{id,email}` is a UI hint only, no tokens in localStorage; sign-out clears the cache; offline sign-out is disabled (cannot clear the cookie) |
| V4 Access Control | yes | Every `/api/*` still enforces `getUserId()`; shells contain no user data (verify: identical HTML with and without cookie); SW never caches `/api/*` |
| V5 Input Validation | yes | Meeting id from `?id=` / pathname validated with `MEETING_ID_RE` before any fetch; use `encodeURIComponent`; never render the raw id |
| V6 Cryptography | no | Nothing new; do not hand-roll |
| V14 Configuration | yes | SW scope `/`; synthetic responses carry COOP/COEP; SW script served same-origin with `no-cache` semantics |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SW caches authenticated API data and serves it to the next user on a shared device | Information disclosure | `/api/*` is pass-through; precache only public static assets and the shared shells |
| Open redirect via the `/meetings/<id>` to `/meeting?id=` rule | Tampering | Redirect target is a fixed path plus a regex-validated id |
| Stale cached identity after explicit sign-out | Spoofing (UI) | `markSignedOut()` clears `lastUserId` and email; Dexie data intentionally kept (Phase 2 D-08, flag for the user on shared devices) |
| Cache poisoning of precache via redirected/captive-portal responses | Tampering | Install guard: `ok && !redirected && type==="basic"` |
| Fake "reachable" from a captive portal | Spoofing | Health probe requires 204; session probe requires parseable JSON |
| Compromised SW script persisting a malicious shell | Elevation | Same-origin only, `updateViaCache:"none"`, version purge on activate |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/03-architecture/nextjs-compiler.md` (Build Lifecycle Hooks, `runAfterProductionCompile`); `node_modules/next/dist/server/config-shared.d.ts` (type); `node_modules/next/dist/build/index.js` (hook runs after compile, before static generation, BUILD_ID written later)
- Throwaway Next 16.2.9 Turbopack spike (deleted): hook output listing `.next/static` at hook time, static `/meeting` with `useSearchParams`+Suspense, dynamic redirect page, headers via `curl` on `next start`, `public/` file written in the hook served with COOP/COEP
- Existing `.next/` of this project: 53 static files, the 26.9 MB asyncify wasm, `login.html` references, response headers of `/login`, `/_next/static/*`, `/ort/*`, `/sw.js`, `/manifest.webmanifest`, `/api/health`
- `node_modules/next/dist/client/components/router-reducer/{fetch-server-response,create-initial-router-state}.js` (MPA fallback on fetch failure and on build-id mismatch; canonical URL from `location.href`)
- `node_modules/next-auth/react/index.js`, `client/_utils.js` (v4.24.15 `fetchData`, `SessionProvider`, `signIn` behaviour)
- `node_modules/@huggingface/transformers/dist/transformers.web.js` 4.3.2 (`getModelFile`/`loadResourceFile`, `get_file_metadata`, `get_model_files`, `is_cached`, `cacheWasm`, env defaults) and Hugging Face tree API for the three repos
- `node_modules/@capacitor/network/.../Network.java` (VALIDATED && INTERNET)
- `.next/static/chunks/turbopack-*.js` (`ChunkLoadError` name)
- `@serwist/turbopack@9.5.15` tarball (`dist/index.mjs`): route-handler build, esbuild, glob at route evaluation, dependency list
- Project source files listed in "Files to change"

### Secondary (MEDIUM confidence)
- https://vercel.com/docs/builds/configure-a-build and https://vercel.com/kb/guide/dynamic-build-commands (build command precedence: `vercel.json` > dashboard > `package.json` build script) (search summaries)
- Vercel community threads (postbuild-generated `public/` files collected: "Collected static files (public/, static/, .next/static)") (search summary)

### Tertiary (LOW confidence)
- Android WebView behaviours (cold-start SW interception, `navigator.connection`, `ignoreVary`) are reasoned from Chromium behaviour and STACK.md source reading, not tested on a device.

## Files to Change

| File | Change |
|------|--------|
| `next.config.ts` | add `compiler.runAfterProductionCompile`; keep headers and turbopack root |
| `sw/routing.js`, `sw/manifest.js`, `sw/sw.template.js`, `sw/build.mjs` | new |
| `public/sw.js` | `git rm` (generated now), add to `.gitignore`; `public/offline.html` `git rm` |
| `package.json` | `test` script glob; no new dependencies; optional `check-build` script |
| `scripts/check-build.mjs` | new post-build assertions |
| `src/app/(app)/layout.tsx` | new: `AuthGate` + `AppShell` |
| `src/app/(app)/page.tsx` (from `src/app/page.tsx`) | strip auth/redirect; render `<Recorder/>` |
| `src/app/(app)/meetings/page.tsx` | strip Prisma/redirect/`force-dynamic`; render `<MeetingList/>` (header counts computed client-side) |
| `src/app/(app)/meeting/page.tsx` | new static shell with Suspense + `MeetingLoader` |
| `src/app/(app)/meetings/[id]/page.tsx` | server `redirect("/meeting?id=...")` with id validation |
| `src/app/offline/page.tsx` | new static page (UI-SPEC section 8) |
| `src/app/login/page.tsx` | connectivity-gated submit, offline line, network error copy, pre-probe before `signIn` |
| `src/components/Providers.tsx` | register SW (prod) / unregister (dev), mount `UpdateNotice`, `AuthProvider`, drop or neuter `SessionProvider`, chunk-error listeners |
| `src/components/AuthGate.tsx`, `AuthProvider.tsx` | new |
| `src/components/SyncProvider.tsx` | use `AuthProvider` instead of `useSession`; also store/clear email |
| `src/components/AppShell.tsx` | pill in top bar and sidebar; email from `AuthProvider`; `/meeting` active state for Meetings tab; disable sign-out offline |
| `src/components/ConnectivityPill.tsx`, `UpdateNotice.tsx`, `OfflineModelControl.tsx` | new (per UI-SPEC) |
| `src/components/MeetingList.tsx` | Dexie as base (no server prop), links to `/meeting?id=`, loading state |
| `src/components/LocalMeetingView.tsx` | becomes `MeetingLoader` (Dexie, then API fetch, then not-on-device state); key `MeetingView` by id |
| `src/components/MeetingView.tsx` | AI button gate + reason line; back link already `/meetings` |
| `src/components/Recorder.tsx` | effective engine, Cloud option disabled, fallback note, OfflineModelControl, honest copy, links to `/meeting?id=${id}` (2 places) |
| `src/components/ui.tsx` | `OptionList` per-option `disabled`; `GateReason` |
| `src/lib/connectivity.ts` (+ `connectivityCore.ts`) | store + `useConnectivity`, keep existing exports |
| `src/lib/featureGate.ts`, `src/lib/authCore.ts`, `src/lib/sw/register.ts`, `src/lib/sw/chunkError.ts` | new |
| `src/lib/navStack.ts` | `parentOf("/meeting")` -> `/meetings` |
| `src/lib/speech/client.ts`, `src/workers/speech.worker.ts`, `src/lib/speech/models.ts`, new `readiness.ts` | `cache-status` and `prefetch` messages, cancel, size labels |
| `mobile/www/index.html` | new copy ("Can't open the app", "Open the app once with internet to set up offline use", Try again); only newly built APKs get it |
| `.gitignore` | add `public/sw.js` |
| `README.md` | line 281 mention of `public/sw.js` (generated) and the offline test recipe |

## Metadata

**Confidence breakdown:**
- Standard stack / SW build wiring: HIGH - verified by running the hook in a Turbopack build and inspecting real `.next` output
- Architecture (static shells, routing, auth, connectivity): HIGH for source-verified behaviour, MEDIUM for WebView runtime (device test)
- Pitfalls: HIGH (most are reproduced or read from source)
- Model caching/readiness: HIGH (library source + HF trees); download UX and eviction behaviour on Android MEDIUM

**Research date:** 2026-11-21
**Valid until:** 30 days for Next/transformers.js specifics (both move fast; re-check `runAfterProductionCompile` if Next is bumped past 16.2.x)
