# Architecture Research

**Domain:** Offline-first meeting transcriber (Next.js 16 App Router web app + Capacitor 8 Android shell with a native foreground-service recorder)
**Researched:** 2026-11-20
**Confidence:** MEDIUM-HIGH overall. Capacitor and Next.js behaviour checked against the installed source (`node_modules/@capacitor/android` 8.6.2, `node_modules/next` 16.2.9) is HIGH. Diarization model choice is MEDIUM/LOW: it needs a spike.

---

## 0. Decisions in One Page

| # | Question | Decision | Confidence |
|---|----------|----------|------------|
| D1 | Service worker on the remote origin, or bundle the web app into the APK? | **Service worker on the remote origin.** Keep `server.url` = the Vercel site. Do not bundle. | HIGH |
| D2 | Does a service-worker-served page still get the Capacitor bridge? | **Yes, on any modern Android System WebView.** Capacitor 8 injects `native-bridge.js` with `WebViewCompat.addDocumentStartJavaScript` (scoped to the `server.url` origin) when `DOCUMENT_START_SCRIPT` is supported. It does not rely on intercepting HTML. Old WebViews fall back to the HTML proxy, which breaks with a service worker and drops COOP/COEP. | HIGH (source-verified) |
| D3 | COOP/COEP with a service worker | Keep the headers in `next.config.ts`. The service worker must cache **real network responses**, so their headers survive. Any `Response` it builds itself (offline fallback, rewrites) must copy `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Otherwise `crossOriginIsolated` is false and WASM drops to one thread. | HIGH |
| D4 | Offline page rendering | Turn `/`, `/meetings` and the meeting page into **static client shells**: no server data, no server `redirect()`. The data comes from IndexedDB and is refreshed from `/api/*` when online. Move the meeting page to `/meeting?id=…`, a single static route, and keep `/meetings/[id]` as a redirect. | HIGH |
| D5 | Offline client navigation | Rely on the Next 16 fallback: a failed RSC fetch, or a non-OK/non-RSC response, makes Next do a full browser navigation. The service worker then serves the precached HTML shell. Do **not** cache RSC payloads, and do **not** turn on `experimental.useOffline`. That flag keeps offline navigations pending, which is the opposite of what this app needs. | HIGH (source-verified) |
| D6 | Local store | IndexedDB with a **state-based sync** (per-meeting dirty flags + server-confirmed `savedParts` cursor), not an operation log. Client-generated meeting IDs make create idempotent. | HIGH |
| D7 | Conflicts | Each field has one owner. The transcript and duration belong to the recording device (single writer, append via `transcriptTail`). `document`/`template` belong to the server (AI). `title` is last-writer-wins by timestamp. Deletes use local tombstones. | MEDIUM-HIGH |
| D8 | Auth offline | Move the session check to the client (`AuthGate`). If the session fetch fails because there is no network, use the cached last-known user. Redirect to `/login` only when the server is reachable **and** says the user is unauthenticated. The APIs still enforce auth. | HIGH |
| D9 | Online gating | Use one `connectivity` module. `navigator.onLine` is only a hint. The real check is a `GET /api/health` probe (`no-store`, never touched by the service worker, 4 s timeout), plus failures seen on real API calls. Deepgram and AI minutes need `reachable && authed`. AI minutes also needs the meeting fully synced. | HIGH |
| D10 | Diarization placement | Compute **one embedding per finished phrase** (the VoiceChunker already produces phrase audio) at low priority in the speech worker. Use **online centroid clustering** for live labels, then a **post-meeting re-cluster** over the stored embeddings to fix the labels. Embeddings are stored locally and never uploaded. Do not keep raw audio (10 h at 16 kHz is about 1.1 GB). | MEDIUM (pattern HIGH, model choice LOW) |
| D11 | Export/share | Build it as a platform adapter. Pure *builders* (meeting → `{filename, mime, bytes}`), then a *deliver* step. Native: `@capacitor/filesystem` writes to Cache, then `@capacitor/share` with `files: [uri]`. Web: `navigator.canShare({files})` → `navigator.share`, falling back to an `<a download>`. Never use the anchor download inside the WebView. | HIGH (pattern), MEDIUM (PDF generator) |
| D12 | Navigation | A client `AppShell` with the brand linking to `/`, a `PageHeader` with a back arrow (history-aware, parent-route fallback), and a `@capacitor/app` `backButton` handler. Every link points to a static shell route, so navigation works offline. | HIGH |

---

## 1. Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI LAYER (React client components, static shells)                            │
│  AppShell / PageHeader / BackButtonBridge                                     │
│  RecordScreen(Recorder)   MeetingsScreen(MeetingList)   MeetingScreen(View)   │
│  ConnectivityBadge  FeatureGate("deepgram" | "ai")  ShareSheet/ExportMenu     │
└───────────────┬───────────────────────┬────────────────────────┬─────────────┘
                │ hooks                 │ liveQuery/subscribe    │ calls
┌───────────────▼───────────┐ ┌─────────▼──────────────┐ ┌───────▼─────────────┐
│ RECORDING LAYER           │ │ DATA LAYER (local-first)│ │ PLATFORM LAYER      │
│ useRecorder (web/on-dev.) │ │ meetingStore (IndexedDB)│ │ connectivity        │
│ useNativeRecorder (DG svc)│─▶ - meetings, partChunks, │ │ authGate/lastUser   │
│ VoiceChunker              │ │   embeddings, kv        │ │ exportShare adapter │
│ speech client ──────────┐ │ │ syncEngine ─────────────┼─▶ nativeBridge (cap) │
└─────────────────────────┼─┘ └─────────┬───────────────┘ └───────┬─────────────┘
                          │             │ fetch /api/meetings*     │ Capacitor plugins
┌─────────────────────────▼──┐          │                          │
│ WORKER: speech.worker.ts   │          │                ┌─────────▼──────────────┐
│  ASR (Moonshine/Whisper)   │          │                │ ANDROID NATIVE          │
│  + diarize: embed job       │          │                │ RecordingService (DG,   │
│  (lowest prio after finals) │          │                │  own autosave via       │
└────────────────────────────┘          │                │  WebView cookie)        │
                                        │                │ Share/Filesystem/App/   │
┌───────────────────────────────────────▼───────────┐    │ Network plugins         │
│ SERVICE WORKER (remote origin, scope "/")         │    └────────────────────────┘
│  precache: app shells, /_next/static, /ort/*.wasm │
│  navigate: network-first → cached shell           │
│  RSC (header RSC:1): network-only → on fail 503   │
│  /api/*: NEVER handled   cross-origin: pass-through│
└───────────────────────────────────────┬───────────┘
                                        │ online only
┌───────────────────────────────────────▼───────────┐
│ SERVER (Vercel): /api/meetings (idempotent create, │
│  tail PATCH, list w/ updatedAt), /process (AI),    │
│  /deepgram/token, /health, next-auth (JWT cookie)  │
│  Neon Postgres via Prisma                          │
└────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation | Communicates with |
|-----------|----------------|----------------|-------------------|
| **Service worker** (`src/app/sw.ts` or `public/sw.js`) | Make the app open and navigate offline after one online visit. Precache the HTML shells, JS/CSS chunks and ORT WASM. Leave APIs and cross-origin traffic alone. | Serwist (`@serwist/turbopack`, because Next 16 builds with Turbopack) or a hand-written SW fed by a build manifest. **Do not use Serwist `defaultCache` as-is.** Write explicit routes so `/api/*` (including `/api/auth/session`) is never cached. | Browser only |
| **AuthGate** (`src/components/AuthGate.tsx`) | Decide between rendering the app, redirecting to `/login`, or "sign in needs internet once". Save the last-known user. | Wraps app routes. Uses `useSession()` + `connectivity` + `lastUser` in localStorage. `SessionProvider refetchWhenOffline={false}`. | next-auth, connectivity, meetingStore (namespacing) |
| **connectivity** (`src/lib/connectivity.ts`) | One source of truth: `offline \| online \| unknown`, plus `authed`. | `online`/`offline` events + `@capacitor/network` (native) as hints. A `/api/health` probe on start, on the `online` event, on visibility, every 30 s while a gated control is on screen, and after any failed API fetch. A `useSyncExternalStore` hook. | syncEngine, FeatureGate, AuthGate |
| **meetingStore** (`src/lib/local/db.ts`) | Durable local copy of every meeting the user has, namespaced by `userId`. | IndexedDB through Dexie (liveQuery makes the list reactive) or `idb`. Schema in section 4. | recorder hooks, screens, syncEngine |
| **syncEngine** (`src/lib/local/sync.ts`) | Push local changes (create, transcript tail, metadata, finish, delete) and pull server changes (list diff, AI documents, meetings recorded on other devices). | A singleton loop with a Web Lock (`navigator.locks`) so only one tab syncs. Triggers: connectivity → online, every 5 s while recording, visibility, after a local write. Exponential backoff. | `/api/meetings*`, meetingStore, connectivity |
| **useRecorder** (existing) | On-device and web-Deepgram recording. | Changes: `save()` writes to **meetingStore first** (always succeeds) and then pokes syncEngine. Never POSTs to create; uses a client ID. | worker, meetingStore, syncEngine |
| **useNativeRecorder** (existing) | Shows the Android foreground-service recorder (Deepgram, screen off). | Changes: generate the client ID, POST/upsert the meeting (online only, since Deepgram needs internet anyway), and mirror the polled `parts` into meetingStore as `origin:"native"`, `syncState:"server-owned"`. The service keeps autosaving to the server by itself. | MeetingRecorder plugin, meetingStore |
| **speech.worker.ts** (existing) | ASR, plus a new `embed` job type for diarization. | A new message type `{type:"embed", id, audio}`. Scheduling order: finals, then embeds, then partials (partials are dropped first). | speech client |
| **diarizer** (`src/lib/speech/diarizer.ts`) | Online clustering (live labels) and re-clustering at stop. | Main-thread (or worker-side) pure TypeScript: cosine distance to centroids, threshold, and a cap on the number of speakers. Agglomerative clustering at stop. | worker results, meetingStore.embeddings |
| **exportShare** (`src/lib/export/*`) | Build TXT/MD/DOC/PDF and deliver it (share or save) on web and native. | Builders are pure. The `deliver()` adapter picks Capacitor Share+Filesystem, the Web Share API with files, or an anchor download. | MeetingView, nativeBridge |
| **nativeBridge** (`src/lib/native.ts`) | Feature-detect plugins (`Capacitor.isPluginAvailable`) so the remote web code keeps working on **older APKs** that lack the new plugins. | Thin wrappers that return `null` when a plugin is unavailable. | all native-touching code |
| **AppShell / PageHeader / BackButtonBridge** | Navigation chrome, back behaviour, Android hardware back. | Client components. `App.addListener("backButton")`: close any open sheet, else go back in history, else on `/` call `App.minimizeApp()` (do not exit while recording). | router, recorder state |

---

## 2. Decision D1 in Detail: Remote-Origin Service Worker vs Bundling into the APK

**Recommendation: remote-origin service worker. Do not bundle.**

What was verified in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/` (8.6.2):

1. `Bridge.loadWebView()`: when `WebViewFeature.DOCUMENT_START_SCRIPT` is supported, it calls `WebViewCompat.addDocumentStartJavaScript(webView, script, {origin of appUrl})` and sets `injector = null`. **The bridge is injected into every document from that origin, including documents a service worker serves from cache.** The old community bug ("Capacitor not defined when served by a service worker") applies only to the legacy injection path. (HIGH)
2. With `injector == null`, `WebViewLocalServer.handleProxyRequest()` returns `null`, so remote requests go to the network untouched and keep their real headers (COOP/COEP). This is why cross-origin isolation already works in the app today. (HIGH)
3. Legacy fallback (very old WebView without `DOCUMENT_START_SCRIPT`): the HTML is proxied through `HttpURLConnection` and rebuilt with `handler.buildDefaultResponseHeaders()`, which **drops COOP/COEP**. Requests that a service worker handles never reach `shouldInterceptRequest`, so there is no bridge. Accept this: any Android with an updated System WebView has the feature. Add a runtime check: if `!window.Capacitor` inside the app, show "Update Android System WebView". (HIGH for the behaviour, MEDIUM for how rare it is)
4. `resolveServiceWorkerRequests` defaults to `true`: the service worker's own fetches go through the same local-server logic and pass through for the remote origin. No config needed. (HIGH)
5. The allowed origin is the **origin only** (path stripped), and navigation must stay on the same origin. Any redirect to another host (for example a Vercel preview domain) loses the bridge. Keep `CAP_SERVER_URL` exactly equal to the production origin. (HIGH)

Why bundling (`output: "export"` into `mobile/www`) loses:

| Concern | Bundled APK | Remote origin + SW |
|---------|-------------|--------------------|
| API routes / NextAuth | Gone from the bundle. Every call is cross-origin `https://localhost` → Vercel, which needs CORS + `SameSite=None` cookies + third-party cookies allowed in the WebView. | Same-origin, as today |
| COOP/COEP | Capacitor's local server serves assets with default headers (no COOP/COEP option), so no `SharedArrayBuffer` and 2-3x slower on-device ASR | Headers come from Vercel |
| Native recorder | `RecordingService` reads the WebView cookie for `baseUrl`. With a bundle, the cookie belongs to a different site. | Works unchanged |
| Updates | Every UI fix needs a new sideloaded APK | Push to main and every APK updates |
| Dynamic route `/meetings/[id]` | Needs `generateStaticParams`, which is impossible for user data | Use the static `/meeting?id=` route |
| Two build targets | Yes | One |

The only thing bundling would give is a working **very first launch** without internet. Handle that in the existing `errorPath` page (`mobile/www/index.html`): change its copy to "Open once with internet to set up offline use", keep the retry button, and optionally add a "Retry when online" listener.

**Service worker specifics for this app**

- **Scope:** `"/"`. If Serwist serves the script from `/serwist/sw.js`, it must register with `scope: "/"` and the route must send `Service-Worker-Allowed: /`. Verify this during the phase (MEDIUM).
- **Precache:** the HTML of `/`, `/meetings`, `/meeting`, `/login`, `/offline` (each built static), all `/_next/static/**`, `/ort/ort-wasm-simd-threaded.{mjs,wasm}` (14 MB, same-origin, needed for threaded WASM), the icons, and `manifest.webmanifest`.
- **Model weights** (Hugging Face, 28-77 MB): leave them to the Transformers.js browser cache (Cache Storage `transformers-cache`, already used). The SW passes cross-origin requests through. Add a "Download for offline" action that loads the chosen model while online, and call `navigator.storage.persist()`.
- **Navigation:** network-first with a 3 s timeout, falling back to the cached shell for that pathname, then `/offline`. Map `/meetings/<id>` to the `/meeting` shell; the page reads the ID from `location`.
- **RSC requests** (header `RSC: 1`, or `?_rsc=`): network-only. On failure, return `Response.error()` so Next does a full navigation (verified in `fetch-server-response.js`: the catch block and the `!isFlightResponse || !res.ok` branch both trigger an MPA navigation). Never cache RSC payloads: they vary by `Next-Router-State-Tree`.
- **`/api/*`:** not intercepted at all. `/api/auth/*` must never be cached.
- **Updates:** do **not** call `skipWaiting()` on its own. A new deployment mid-recording would switch the chunks under a live session and risk a `ChunkLoadError`. Instead, show "Update ready", and activate on the next launch or when the user taps it while not recording (send `postMessage({type:"SKIP_WAITING"})`, then reload).

---

## 3. Recommended Project Structure (additions only)

```
src/
├── app/
│   ├── page.tsx                  # static shell: <AuthGate><AppShell><Recorder/></AppShell></AuthGate>
│   ├── meetings/page.tsx         # static shell: MeetingList reads meetingStore
│   ├── meetings/[id]/page.tsx    # thin redirect → /meeting?id= (kept for old links)
│   ├── meeting/page.tsx          # static shell: MeetingView({id from searchParams})
│   ├── offline/page.tsx          # static fallback
│   ├── sw.ts                     # service worker source (if Serwist)
│   └── api/
│       ├── health/route.ts       # 204, no-store, no DB hit (reachability probe)
│       └── meetings/…            # + client id, idempotent POST, ?since= list
├── lib/
│   ├── connectivity.ts           # reachability state + useConnectivity()
│   ├── native.ts                 # plugin feature-detection wrappers
│   ├── local/
│   │   ├── db.ts                 # IndexedDB schema (meetings, partChunks, embeddings, kv)
│   │   ├── repo.ts               # getMeeting/listMeetings/appendParts/setTitle/tombstone
│   │   └── sync.ts               # syncEngine (push/pull, backoff, web lock)
│   ├── export/
│   │   ├── builders.ts           # toTxt / toMarkdown / toDocHtml / toPdf (pure)
│   │   └── deliver.ts            # share() / save() across Capacitor + web
│   └── speech/
│       ├── diarizer.ts           # online clustering + final re-cluster
│       └── embeddingModel.ts     # model id, sizes, sample-rate contract
├── components/
│   ├── AuthGate.tsx
│   ├── FeatureGate.tsx           # disables + explains Deepgram / AI offline
│   ├── PageHeader.tsx            # title + back arrow
│   ├── BackButtonBridge.tsx      # Android hardware back
│   └── ExportMenu.tsx            # Share… / Save as TXT · Word · PDF
└── hooks/
    ├── useLocalMeeting.ts        # liveQuery(meetingStore) + background refresh
    └── useLocalMeetings.ts
```

**Why this layout:** `lib/local` is the only code that knows about IndexedDB, and `lib/export` the only code that knows about the share mechanism. Screens stay oblivious to whether they are on a phone, in an app or online. That is what lets the UI redesign phase restyle screens without touching data or platform code.

---

## 4. Data Model

### Server (Prisma) changes, all backward-compatible

```prisma
model Meeting {
  id            String   @id            // now client-supplied (cuid2/uuid); default kept for old clients
  ...
  /// TranscriptPart[]: [{ speaker: number, text: string, t?: number }]   ← speaker already exists
  transcript    Json     @default("[]")
  /// Optional names the user gave speakers: { "0": "Asha", "1": "Ravi" }
  speakerNames  Json?
  /// "deepgram" | "moonshine" | "whisper" — tells the UI whether speaker labels came from the cloud
  engine        String?
  titleUpdatedAt DateTime?               // LWW for title edits made offline
  updatedAt     DateTime @updatedAt      // already exists, used for list diffs
}
```

- `TranscriptPart.speaker` **already exists** (0-based number, zod `int().min(0)`). On-device engines write `0` today (`appendFinal`). Diarization only has to fill it in. `transcriptToText` already prints `Speaker N:` only when there is more than one speaker. No format migration needed. (HIGH, verified in `src/lib/transcript.ts` and `api/meetings/[id]/route.ts`)
- **POST /api/meetings:** accept `id` (validate `^[a-z0-9_-]{16,40}$`), `createdAt`, `engine`. Upsert scoped by `userId`: if the ID exists for this user, return `200 {meeting, savedParts}`. If it exists for another user, return 409. This makes create idempotent, which the sync queue needs.
- **PATCH /api/meetings/:id:** keep `transcriptTail` (it is already a resumable cursor protocol with a 409 + `savedParts` resync). Add:
  - `speakers: { from: number, labels: number[] }`: relabels after the post-meeting re-cluster without resending text (a 10 h meeting is about 24k parts and about 1 MB of text).
  - `titleUpdatedAt`: the server applies `title` only if it is newer than the stored value.
  - `speakerNames`.
- **GET /api/meetings?since=ISO:** returns metadata changed since then plus the full `ids` list, so the client can spot server-side deletions without tombstones on the server.
- **GET /api/health:** cheap, no DB, `Cache-Control: no-store`.

### Local (IndexedDB), namespaced by `userId`

| Store | Key | Value | Notes |
|-------|-----|-------|-------|
| `meetings` | `id` | `{id, userId, title, titleUpdatedAt, language, engine, deviceName, status, durationSec, createdAt, template, document, speakerNames, origin: "local"\|"server"\|"native", savedParts, serverUpdatedAt, dirty: {tail, meta, speakers, finish}, deleted, syncError}` | `savedParts` = the server-confirmed cursor, **persisted**. Today it is an in-memory ref, lost on reload. |
| `partChunks` | `[meetingId, chunkNo]` | `TranscriptPart[]` (≤ 200 parts) | Only the last chunk is rewritten every 5 s. Rewriting one 24k-element array every 5 s for 10 h is the trap to avoid. |
| `embeddings` | `[meetingId, partIndex]` | `Float32Array` (e.g. 192/256-d) | Local only. About 24k × 1 KB = 24 MB for 10 h. Deleted once the meeting is DONE and re-clustered, or kept for "re-run speaker detection". |
| `kv` | key | `lastUser`, `lastPullAt`, model-ready flags | |

**Which list a screen shows:** the meetings list = local meetings ∪ server list (pulled when online). Server-only meetings (recorded on the laptop) get a metadata row, and their transcript is fetched lazily when opened online and then cached. That is enough for "open past meetings offline".

---

## 5. Data Flows

### 5.1 Offline on-device recording (web or app, screen on)

```
tap Record (engine=moonshine|whisper; allowed offline)
  → id = createId(); meetingStore.put({id, origin:"local", status:"RECORDING", dirty.meta:true})
  → worker.load(model) (from transformers-cache; fails with "download model while online" if absent)
  → VoiceChunker phrase → worker "final" → appendFinal → repo.appendParts(id, part)   [IndexedDB]
                        → worker "embed" (low prio) → diarizer.assign(emb) → part.speaker = k
  → every 5 s: repo persists the tail; syncEngine.poke()  (no-op while unreachable)
  → Stop: status DONE; diarizer.recluster(all embeddings) → repo.relabel(); dirty.finish/speakers
```

The UI's `saveState` becomes two values: **"Saved on this device"** (always) and **"Synced" / "Waiting for internet"**.

### 5.2 Sync push (when reachable and authed)

```
for each meeting with dirty flags (oldest first):
  if not on server: POST /api/meetings {id, title, language, engine, deviceName, createdAt}   (idempotent)
  if dirty.tail:    PATCH {transcriptTail:{from: max(0,savedParts-1), parts}, durationSec}
                    in batches of ≤ 2000 parts; 409 → savedParts = server.savedParts → retry
  if dirty.speakers: PATCH {speakers:{from:0, labels}}
  if dirty.meta:    PATCH {title, titleUpdatedAt, speakerNames}
  if dirty.finish:  PATCH {status:"DONE"}
  if deleted:       DELETE → purge local rows
401 → pause sync, keep everything, show "Sign in to sync N meetings" (never drop the queue)
```

This reuses the server's existing `transcriptTail` semantics (`from` = last confirmed index minus 1, because the last phrase can still grow). The server replaces everything from `from` onwards, so sequential batches are safe.

### 5.3 Sync pull

`GET /api/meetings?since=lastPullAt` → upsert metadata into `meetings` (respecting the field ownership below) → for open, or recently viewed, meetings whose `serverUpdatedAt` moved, `GET /api/meetings/:id` → replace `partChunks` **only if the meeting is not locally owned and dirty**.

### 5.4 Field ownership (conflict handling)

| Field | Owner | Rule |
|-------|-------|------|
| `transcript`, `durationSec`, `status` | The device that recorded it (`origin:"local"`); for native-service meetings, the `RecordingService` | Single writer. The server never edits them. Pull never overwrites a locally dirty transcript. |
| `speaker` labels, `speakerNames` | The recording device, then the user | Last write wins per PATCH. Rare. |
| `title` | User, on any device | LWW by `titleUpdatedAt` (client clock, acceptable for a single user) |
| `document`, `template` | Server (`/process`) | Pull always wins. Never pushed by the client. |
| existence | User | Local delete = tombstone until the DELETE succeeds. A server ID missing from `ids` = deleted elsewhere → remove locally unless dirty, in which case keep it and re-create (surface a notice). |

A real concurrent conflict would need two devices writing the same meeting's transcript, which this product never does. A vector-clock or CRDT design would be over-engineering here.

### 5.5 Native (Deepgram, screen off) recording in the app

```
online required (FeatureGate) → id = createId() → POST /api/meetings {id,…}
→ MeetingRecorder.start({meetingId:id, baseUrl}) → service streams DG + autosaves to server itself
→ page polls getState → mirrors parts into meetingStore (origin:"native", not pushed by syncEngine)
→ on finish: pull the meeting from the server to get the authoritative copy
```

There are no Java changes for the basic path. The service already backlogs audio through Wi-Fi drops.

### 5.6 AI minutes

The `/process` route reads the transcript **from the DB**. So "Generate" is enabled only when `reachable && authed && meeting.syncState === "synced"`. If the meeting is dirty, the button first runs `sync.flush(id)`, then calls `/process`. The resulting `document` is written into meetingStore so it is readable offline. Offline, the button is disabled and says "Needs internet. Your transcript is saved and will sync automatically."

### 5.7 Export/share

```
ExportMenu → builders.toX(meeting from meetingStore) → {filename, mime, data: string | Uint8Array}
  → deliver.share(file):
      native & Share available:  Filesystem.writeFile({directory: Cache, path, data: base64})
                                 → Share.share({title, files:[uri]})      (WhatsApp/Drive/Telegram…)
      web & navigator.canShare({files:[File]}): navigator.share({files, title})
      else: deliver.save(file)
  → deliver.save(file):
      native: Filesystem.writeFile(Documents|Cache) + Share (Android has no "Downloads" without SAF)
      web: <a download> (existing helper)
  → "Share as text": Share.share({text}) / navigator.share({text}) / clipboard
```

Everything works offline. For PDF, drop the html2canvas path (`html2pdf.js` fails in the WebView; the exact root cause is unverified and could be canvas/COEP or the blob anchor). Generate a **text-based PDF** (jsPDF `text()`/`splitTextToSize` with an embedded Unicode font for Hindi) or `pdf-lib`. Both give small files that work everywhere. The STACK research should pick the library.

### 5.8 Navigation

- The brand is a `<Link href="/">` (it already is; it must stay a Link so offline MPA fallback applies).
- `PageHeader` back arrow: `history.length > 1 && document.referrer is same-origin` → `router.back()`, else `router.push(parentRoute)` (meeting → `/meetings`).
- Android back: `App.addListener("backButton", ({canGoBack}) => …)`, registered once in `BackButtonBridge`. Order: close an open sheet/dialog → `router.back()` if `canGoBack` → on `/`, `App.minimizeApp()`. Leaving the Record screen during a web recording already stops and saves it. With the local store, that save is instant and loses nothing.

---

## 6. Diarization Pipeline (D10)

**Placement: a post-phrase embedding inside the speech worker, plus online clustering, plus a post-meeting re-cluster.** A pure post-meeting pass over audio was rejected because it requires keeping the audio (about 1.1 GB for 10 h) and gives no live labels. Online-only clustering was rejected because early mistakes (two people merged before enough evidence) would never get fixed.

```
VoiceChunker phrase (16 kHz Float32, ~1–15 s)
   ├─▶ worker: ASR "final" (priority 1)
   └─▶ worker: "embed" (priority 2, before partials)  → 192/256-d L2-normalised vector
          ├─ phrase < 1.0 s → no embedding; inherit previous speaker (short "yes/ok" turns)
          └─ diarizer.assign(v): nearest centroid by cosine; if sim < θ (≈0.5–0.6, tune) and
             speakers < maxSpeakers(8) → new speaker; else update centroid (running mean)
Stop → diarizer.recluster(all vectors): agglomerative (average linkage, cosine) with the same θ
     → stable renumbering by first appearance → speakers PATCH {from:0, labels}
```

- **Model (needs a spike, LOW confidence):** a small speaker-verification ONNX model (WeSpeaker ResNet34 / 3D-Speaker ERes2Net / CAM++, about 7-30 MB) running on the **onnxruntime-web already shipped** (`/ort/` WASM, threaded) inside the same worker. That reuses the runtime and thread pool. sherpa-onnx WASM is the proven browser diarization stack (a HF Space demo exists), but it brings a second WASM runtime and offline-only full-file diarization. If it is chosen, run it in a **separate worker with `numThreads=1`** so it doesn't fight ASR for cores on phones.
- **Phrases with two speakers:** v1 accepts phrase-level granularity. v2 can embed sliding 1.5 s windows inside long phrases and split at change points.
- **Deepgram meetings skip local diarization**: Deepgram already labels speakers.
- **Data model:** none needed beyond the `embeddings` store and the `speakers` PATCH. `speakerNames` is an optional nicety ("Speaker 1 → Asha").
- **Cost guard:** if the worker backlog of finals is above N, skip embedding for that phrase and inherit the label. Accuracy degrades gracefully instead of the transcript lagging.

---

## 7. Architectural Patterns

### Pattern 1: Static client shells + local-first data
**What:** Each route's server component renders only `<AuthGate><AppShell><Screen/></AppShell></AuthGate>` with `export const dynamic = "force-static"`. Screens read from meetingStore through `liveQuery` and fire a background refresh.
**When:** Any route that must open offline.
**Trade-offs:** You lose the server-rendered first paint of the meetings list. The local read is instant on repeat visits, so this costs nothing in practice. The HTML is user-agnostic, so it is safe to cache.

```tsx
// src/app/meetings/page.tsx
export const dynamic = "force-static";
export default function Page() {
  return <AuthGate><AppShell><MeetingsScreen /></AppShell></AuthGate>;
}
```

### Pattern 2: Write-local-then-sync with a persisted cursor
**What:** The recorder never awaits the network. `repo.appendParts()` then `sync.poke()`. The sync loop owns retries, backoff and 409 resync.
**Trade-offs:** Two sources of truth to reason about. Field ownership (5.4) keeps that tractable.

### Pattern 3: Capability gate, not an online flag
**What:** `useCapability("deepgram" | "ai" | "sync")` returns `{enabled, reason}` computed from connectivity, auth, plugin availability and sync state. Components show the reason next to the disabled control.
**Trade-offs:** One more abstraction. It stops "online" checks from spreading across 10 components.

### Pattern 4: Platform adapter with feature detection
**What:** `deliver.share()`, `native.backButton()` and `native.network()` check `Capacitor.isPluginAvailable` at call time. The remote web code can be newer than the installed APK, so every native call needs a web fallback or a "Please update the app" message.

---

## 8. Anti-Patterns to Avoid

| Anti-Pattern | Why it's bad | Instead |
|--------------|--------------|---------|
| Bundling the Next app into the APK | Breaks the API, auth cookies, COOP/COEP and the native service's cookie lookup; forces an APK release for every UI change | Remote-origin SW (D1) |
| Server components with `redirect("/login")` / Prisma reads on app pages | The cached HTML embeds one user's data. Offline it can't render. A precache fetch while signed out caches the login redirect. | Static shells + AuthGate |
| Caching `/api/*` or `/api/auth/session` in the SW (Serwist `defaultCache` has API runtime caching) | Stale session = wrong user or a "logged in" ghost; stale meetings | SW ignores `/api/*`. IndexedDB is the only data cache. |
| Caching RSC payloads | They vary by router state tree. Wrong payload = broken render. | Network-only RSC, MPA fallback |
| `skipWaiting()` on install | Swaps chunks mid-recording → ChunkLoadError | User-triggered activation when idle |
| Treating `navigator.onLine === true` as online | True on Wi-Fi without upstream, captive portals | `/api/health` probe |
| `useSession()` status `"unauthenticated"` → redirect while offline | next-auth reports a failed session fetch as no session. The user gets bounced to a login page that can't work offline. | AuthGate checks reachability first |
| Rewriting the whole transcript array in IndexedDB every 5 s | 10 h meetings mean multi-MB writes every 5 s, battery and jank | `partChunks` |
| Signing out clears local data that hasn't synced | Data loss | Block or confirm when unsynced meetings exist |
| Storing raw audio for a diarization post-pass | GB-scale storage on phones with full disks | Per-phrase embeddings |
| `<a download>` / `window.open(blobUrl)` in the Capacitor WebView | No-op (the current bug) | Filesystem + Share |

---

## 9. Build Order (with dependencies)

Each step below lists what it depends on and what it unblocks. The plugins needed by A and later steps ship in **one** APK rebuild (`@capacitor/share`, `@capacitor/filesystem`, `@capacitor/app`, `@capacitor/network`), so the user sideloads once.

```
A. Platform plumbing + Export/Share + Nav shell ─────────────┐ (independent; quick win)
B. Local data layer + sync + server API changes ─────────────┤
      │                                                      │
      ├──▶ C. Offline shell (SW, static routes, AuthGate, gating UI)
      │                                                      │
      └──▶ D. On-device diarization (embed job, clustering, relabel sync)
                                                             │
E. UI redesign (after A–C settle the screen structure) ◀─────┘
F. (stretch) Native local-capture for screen-off on-device recording
```

**A. Platform plumbing, export/share, navigation** (no dependencies)
- `lib/native.ts` feature detection. Add the four Capacitor plugins. Rebuild the APK.
- `lib/export/builders.ts` + `deliver.ts`. Replace the `download()`/html2pdf paths in MeetingView. Use a text PDF.
- `PageHeader`, `BackButtonBridge`, the brand link to home.
- Unblocks: user-visible fixes now. B/C reuse `native.network()` and the nav shell.

**B. Local-first data layer** (no dependency on A beyond `native.ts`)
- Server: client IDs + idempotent POST, `?since=` list, `/api/health`, `speakers` and `titleUpdatedAt` PATCH, Prisma additions (`db push`).
- `lib/local/db.ts`, `repo.ts`, `sync.ts`, `lib/connectivity.ts`.
- `useRecorder.save()` → local first. `start()` stops POSTing before recording (create goes through sync). `useNativeRecorder` mirrors into the store.
- Screens read from the store (`useLocalMeetings`, `useLocalMeeting`). Pages can still be server-rendered at this step. Online behaviour is unchanged, so it ships safely on its own.
- Unblocks: C (pages no longer need server data) and D (embeddings store, speakers PATCH).

**C. Offline shell and gating** (depends on B)
- Convert the routes to static shells, add `/meeting?id=`, redirect `/meetings/[id]`, add AuthGate + `lastUser`, `SessionProvider refetchWhenOffline={false}`.
- Service worker (Serwist turbopack or hand-written) with precache, navigation fallback, RSC network-only, `/api` bypass, idle-time update prompt, COOP/COEP-preserving fallbacks.
- `FeatureGate` for Deepgram/AI. "Download model for offline". `navigator.storage.persist()`. Update the `mobile/www` first-launch page copy.
- Verify on the Xiaomi device: airplane mode, cold start of the app → Record → Meetings → open a meeting → back.

**D. Diarization** (depends on B; can run in parallel with C)
- Spike: choose the embedding model (size, RTF on the Xiaomi phone, DER on a recorded 3-speaker clip).
- Worker `embed` job + priority, `diarizer.ts`, `embeddings` store, re-cluster at stop, `speakers` sync, speaker rename UI.

**E. UI redesign** (best after A-C have fixed which screens and components exist; design tokens can start in parallel)

**F. Stretch: screen-off on-device recording in the app.** On-device engines in the app still need the screen on (WebView mic). Extend `RecordingService` with a "local capture" mode that writes 16 kHz PCM to a per-meeting file (`AudioBacklog` is already file-backed). The page pulls chunks through the plugin (`readAudio({from})`, about 43 KB/s base64) into VoiceChunker and the worker: live while visible, catching up after unlock. This is high complexity and needs its own research, because whether WebView JS keeps running with the screen off is LOW confidence. It is the only route to "record a whole meeting offline with the phone locked", which is the Core Value.

---

## 10. Scalability Considerations

| Concern | Typical (1 h meeting) | 10 h meeting | Many meetings (100s) |
|---------|-----------------------|--------------|----------------------|
| IndexedDB writes | Last chunk every 5 s | Same (chunked) | — |
| First sync after an offline meeting | 1 POST + 1-2 PATCH | About 12 batched PATCHes; the server is O(n) per PATCH (reads and writes the JSON) and stays under the 4.5 MB Vercel body limit | Sequential queue, oldest first |
| Embeddings | About 2.4k × 1 KB | About 24 MB, purged after re-cluster | Purge on DONE |
| Re-cluster at stop | Milliseconds | O(n²) agglomerative on 24k is too slow. Cluster centroids of 30 s windows, or use the online result + a merge pass | — |
| Storage quota | Models 28-77 MB + ORT 14 MB | — | `navigator.storage.estimate()` shown in settings |

---

## 11. Sources

- Capacitor Android 8.6.2 source, installed: `Bridge.java` (`addDocumentStartJavaScript`, `ServiceWorkerController`), `WebViewLocalServer.java` (`handleProxyRequest`, default headers). HIGH
- Next.js 16.2.9 source, installed: `dist/client/components/router-reducer/fetch-server-response.js` (failed RSC fetch → MPA navigation). HIGH
- [Next.js docs: Offline support / `experimental.useOffline`](https://nextjs.org/docs/app/guides/offline-support): experimental; a full offline load needs a service worker; `navigator.onLine` is unreliable. HIGH
- [Serwist Turbopack guide](https://serwist.pages.dev/docs/next/turbo): `@serwist/turbopack`, route-served SW, `SerwistProvider`. MEDIUM
- [Capacitor issue #7454](https://www.github.com/ionic-team/capacitor/issues/7454) and [Ionic forum: plugins not working through service worker](https://forum.ionicframework.com/t/plugins-not-working-through-service-worker/220588): historical SW and bridge-injection failures (the legacy path). MEDIUM
- [Lightrun: service worker + server.url not injecting Capacitor](https://lightrun.com/answers/ionic-team-capacitor-bug-service-worker-serverurl-not-injecting-capacitor). LOW (historical)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and the [WASM speaker diarization HF Space](https://huggingface.co/spaces/k2-fsa/web-assembly-speaker-diarization-sherpa-onnx/blob/ad165c7e9184fb736c9919a1df1153e17ccca133/index.html): a browser diarization stack exists. MEDIUM
- [Parakeet Web](https://github.153394839.workers.dev/thiswillbeyourgithub/parakeet_web): a client-side app that vendors the sherpa-onnx diarization WASM in its own ORT. LOW
- Codebase: `capacitor.config.ts`, `next.config.ts`, `public/sw.js`, `src/app/**`, `src/hooks/useRecorder.ts` (save/tail protocol), `useNativeRecorder.ts`, `src/lib/transcript.ts`, `api/meetings/[id]/route.ts`, `RecordingService.java`, `AudioBacklog.java`, `prisma/schema.prisma`.

---
*Architecture research for: offline-first meeting transcriber (Next.js + Capacitor)*
*Researched: 2026-11-20*
