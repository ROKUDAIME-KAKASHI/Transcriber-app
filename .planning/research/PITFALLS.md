# Pitfalls Research

**Domain:** Next.js 16 App Router + Capacitor 8 (Android, `server.url` remote site) meeting transcriber. This milestone adds working exports, a native share sheet, offline-first operation, online-only gating, on-device diarization, a UI with motion, and navigation fixes.
**Researched:** 2026-11-20
**Confidence:** MEDIUM overall. HIGH where it comes from reading this repo's code and the installed Capacitor 8 Android sources in `node_modules/@capacitor/android`. MEDIUM/LOW where it rests on community reports, which are marked.

Phase names used below (the roadmapper can rename them):
- **P-Export**: exports and share sheet
- **P-Nav**: navigation and the Android back button
- **P-Offline**: service worker, app shell, local store, sync
- **P-Gate**: online/offline detection and gating
- **P-Diar**: on-device diarization
- **P-UI**: redesign and motion

---

## Critical Pitfalls

### Pitfall 1: Blob + `<a download>` does nothing in the Capacitor WebView

**What goes wrong:**
`MeetingView.tsx` `download()` creates a `blob:` URL and clicks a hidden anchor. Chrome saves the file. The Android WebView ignores it. WebView only hands downloads to `DownloadListener`, Capacitor's `BridgeActivity` registers no listener that saves `blob:` URLs, and `DownloadManager` throws "Can only download HTTP/HTTPS URIs" for `blob:`. That is why the Word and TXT buttons silently do nothing. Delaying `revokeObjectURL` (already done) does not help.

**Why it happens:**
The `download` attribute is a browser feature, not a WebView feature. Developers test on desktop Chrome or mobile Chrome, where it works.

**How to avoid:**
- Build one export abstraction: `exportFile({ name, mime, data: Blob })`.
  - **Native** (`Capacitor.isNativePlatform()` and `Capacitor.isPluginAvailable('Share')`): convert the Blob to base64 with FileReader, then call `Filesystem.writeFile({ directory: Directory.Cache, path, data })` with **no `encoding`** (binary files are base64-decoded only when encoding is omitted; passing `Encoding.UTF8` corrupts PDFs). Then call `Share.share({ files: [uri] })`.
  - **Web**: try `navigator.canShare({ files })`, then `navigator.share`, then fall back to the anchor download.
- Use `Directory.Cache`. `@capacitor/share` on Android can only share from the cache folder unless you edit `res/xml/file_paths.xml` (official docs).
- Use real `.docx` only if needed. The current `application/msword` HTML-as-`.doc` works in Word but WhatsApp and Drive previews may show it as an unknown file. Offering TXT and PDF as the main share formats is safer.

**Warning signs:**
Buttons that "do nothing" with no console error. `chrome://inspect` on the laptop shows the click but no download. Logcat shows `IllegalArgumentException ... blob:`.

**Phase to address:** P-Export (first; it is the most visible broken feature)

---

### Pitfall 2: The PDF failure has two causes, and fixing one leaves the other

**What goes wrong:**
1. **html2canvas cannot parse Tailwind v4 colours.** Tailwind v4 emits `oklch()` / `color-mix()` throughout its theme and preflight. `html2pdf.js@0.14` depends on stock `html2canvas@^1`, which throws `Attempting to parse an unsupported color function "oklch"`. The node is rendered inside the page, so it inherits those styles. This is the most likely cause of the caught exception behind "Couldn't make the PDF" (MEDIUM: widely reported for Tailwind v4 plus html2canvas, not yet reproduced on this app).
2. **Even when the canvas renders, `.save()` uses jsPDF's anchor download**, which hits Pitfall 1 in the WebView.

Other failure modes:
- **Canvas size limits:** a long transcript at `scale: 2` can exceed mobile canvas limits (roughly 16k px per side or about 16-50 MP total on Android Chrome). You get a blank or black canvas, or an exception. A 10-hour transcript certainly exceeds them.
- **Memory:** html2canvas rasterises everything to JPEG. A 100-page PDF from a 10-hour meeting can run out of memory on a low-end phone.
- **COEP `require-corp`:** any cross-origin image or font in the exported HTML is blocked unless it is CORS/CORP-enabled, and html2canvas taints or fails on it. Self-host fonts (`next/font` already does this).
- **Fonts:** Hindi (Devanagari) text needs a font that has the glyphs. With raster export it only renders if the WebView has a system font for it. With a text-based PDF you must embed a Devanagari TTF.

**How to avoid:**
- Do not add `html2canvas-pro` as a band-aid unless you keep raster PDFs. Prefer a **text-based PDF**: either jsPDF `text()` / `splitTextToSize` with an embedded font, or `pdf-lib` / `pdfmake` built from the transcript data instead of the DOM. This avoids canvas limits, keeps the PDF small and searchable, and fixes the colour issue.
- If you keep html2pdf: render into an **isolated iframe or a detached element with inline hex/rgb styles only**, use `scale: 1` with `pagebreak` mode, and call `.outputPdf('blob')` instead of `.save()`, then hand the Blob to `exportFile()`.
- Test with a 2-hour Hindi transcript on the Xiaomi phone, not with a sample paragraph.

**Warning signs:**
`console.error("PDF export failed:")` mentions oklch or color. Exports work for short meetings and fail for long ones. The PDF is blank on the phone but fine on the laptop.

**Phase to address:** P-Export

---

### Pitfall 3: Web/APK version skew with `server.url`, where new web code calls plugins old APKs lack

**What goes wrong:**
The web app deploys on every push to main. Native plugins (`@capacitor/share`, `@capacitor/filesystem`, `@capacitor/app`) only exist in APKs built after they were added. People already hold older APKs. New web code calls `Share.share()` and gets `"Share" plugin is not implemented on android`. That can break the whole export or back-button flow.

**Why it happens:**
With `server.url`, the JS and native halves ship independently. `npm install @capacitor/share` changes nothing on a phone until `npx cap sync android`, a rebuild, and a reinstall.

**How to avoid:**
- Guard every native call with `Capacitor.isPluginAvailable('X')` and always keep a web fallback.
- Expose a small native "capabilities/version" call (or read `App.getInfo()` when available) and show "Update the app to share files" for old APKs instead of failing.
- Ship the new APK **before** or together with the web deploy that depends on it, and record the minimum APK version in a constant.
- Do not rename or remove existing `MeetingRecorderPlugin` methods. Only add new ones.

**Warning signs:**
"not implemented on android" in the console. Features that work on the developer's phone (new APK) fail for shared-APK users.

**Phase to address:** P-Export (first plugin added). Applies to every phase that adds native code.

---

### Pitfall 4: Offline recording with the screen off. On-device engines run in the WebView, and the WebView mic pauses on lock

**What goes wrong:**
The core value is "record a whole meeting anywhere, with or without internet". Today only the **Deepgram** path runs in the native foreground service (`RecordingService`). Moonshine and Whisper run in a Web Worker inside the WebView. As the project's own Key Decisions note, the WebView pauses the mic when the screen locks. Offline equals on-device, and on-device equals stopping when the phone locks. Offline-first can ship and still miss the main use case.

**How to avoid:**
- In the app, when offline (or for any on-device engine), let the **native service capture PCM to a file** (the `AudioBacklog` already writes `recording-backlog.pcm`). Then either:
  - (a) feed chunks to the WebView worker whenever the page is awake and catch up after unlock, or
  - (b) when Deepgram is reachable again, send the backlog to Deepgram (the existing backlog design already does this for dropouts).
- Make the UI honest: "On-device transcription catches up when you unlock the screen."
- Decide this in roadmap planning. It shapes the P-Offline and P-Diar architecture, since diarization also needs the audio.

**Warning signs:**
An offline test meeting with the screen locked for 10 minutes comes back with a 10-minute hole. There is no error, just silence.

**Phase to address:** P-Offline (architecture decision), validated in P-Diar

---

### Pitfall 5: The service worker caches per-user, SSR, auth-redirecting pages, or a stale build

**What goes wrong:**
`/`, `/meetings` and `/meetings/[id]` are **server components that call `getServerSession` and `redirect("/login")`**. Offline there is no server, so:
- A naive "cache the navigation response" SW stores the HTML for whoever was logged in. It can also store a **redirect to /login**. Serving a redirected response to a navigation throws "a redirected response was used for a request whose redirect mode is not 'follow'", which shows as a blank page.
- App Router client navigations do not request HTML. They fetch **RSC payloads** (`?_rsc=…`, `RSC: 1` header) and prefetches. If those are not handled, `<Link>` clicks fail offline even when `/` is cached, and Next falls back to a hard navigation.
- **Build skew:** cached HTML references hashed `/_next/static/chunks/*.js`. After the next push, Vercel serves only the new deployment's chunks (Skew Protection is not on Hobby). A cached shell then loads 404 chunks: white screen or ChunkLoadError.

**How to avoid:**
- Restructure: make the **record screen and the meetings list client-rendered shells** that read from IndexedDB and check auth on the client (with a cached session hint). Keep SSR for online-only data, or drop it for these routes.
- Use a build-integrated precache (Serwist; for Next 16 with Turbopack that is `@serwist/turbopack`, MEDIUM, check its current docs) so the shell HTML and **all of its chunks** are precached atomically per build and versioned. Never hand-roll a runtime "cache whatever was fetched" policy for `_next/static`.
- Navigation strategy: network-first with a short timeout, falling back to the precached app shell (one static shell route, not per-user SSR HTML). Never cache responses with `response.redirected` or non-200 status.
- Handle RSC requests offline: either fall back to a hard navigation to the shell, or cache RSC payloads for the shell routes. Test `<Link>` navigation in airplane mode.
- Use `skipWaiting`/`clients.claim` carefully. The current SW calls both, which swaps the SW mid-recording. Prefer "new version ready, reloads when you are not recording."
- On **sign-out**, clear Cache Storage entries that hold user data, and clear IndexedDB.

**Warning signs:**
Offline, the app opens to the login page or a blank page. After a deploy the app is white until you clear data. `ChunkLoadError` appears in the console.

**Phase to address:** P-Offline (core, needs deeper research)

---

### Pitfall 6: Cross-origin isolation (COOP/COEP) breaks when the SW or Capacitor serves the page

**What goes wrong:**
On-device speed relies on `crossOriginIsolated === true` (SharedArrayBuffer for threaded WASM, `ort-wasm-simd-threaded.wasm`). Ways it can silently turn off:
- The SW returns a synthesised `new Response(html)` (for example an offline page) **without** the `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy` headers. Cached responses from `fetch` keep their headers. Responses built by hand do not.
- **Capacitor's HTML proxy path drops server headers.** In the installed Capacitor 8 `WebViewLocalServer.handleProxyRequest`, HTML is refetched natively and returned with `handler.buildDefaultResponseHeaders()`, not the server's headers. This only runs when `WebViewFeature.DOCUMENT_START_SCRIPT` is **unsupported** (old WebView builds). Modern WebViews take the `addDocumentStartJavaScript` path (`Bridge.java` line ~266). Older-WebView users of the shared APK may therefore lose isolation (HIGH from source; how many users are affected is unknown).
- New UI assets from CDNs (Lottie JSON, Google Fonts, avatars, a hosted motion library) that lack CORS/CORP get blocked under `require-corp`.
- `opaque` (`no-cors`) responses in the SW cache cannot be used by COEP pages.

**How to avoid:**
- Log `crossOriginIsolated` and `navigator.hardwareConcurrency` in the worker "ready" message (`threads` is already reported) and show it in a debug panel.
- Have a SW helper that clones the cached shell response and **adds COOP/COEP** when needed.
- Self-host every UI asset. Never add third-party `<script>`, `<img>` or font URLs without CORS.
- Keep the single-threaded fallback working (`numThreads = 1`) so losing isolation costs speed, not function.

**Warning signs:**
`threads: 1` on a phone that used to report 4. Transcription is suddenly 2-3 times slower after the SW ships. Console shows `ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`.

**Phase to address:** P-Offline (SW), P-UI (new assets)

---

### Pitfall 7: Model caching. Not fully warmed, evicted under storage pressure, or the cache key changes

**What goes wrong:**
- Transformers.js caches Hugging Face files in Cache Storage (`transformers-cache`) lazily, only the files actually fetched. If the user only ever used Moonshine Tiny, Whisper (77 MB) is not cached and fails offline. Optional files (`generation_config.json`, `preprocessor_config.json`, tokenizer files) fetched only on certain code paths fail mid-meeting.
- The ORT runtime `public/ort/ort-wasm-simd-threaded.wasm` (about 14 MB) and the worker bundle are same-origin and must also be precached. A long `immutable` HTTP cache header is not an offline guarantee.
- **Eviction:** WebView storage is "best-effort" by default. Under low disk (common on budget phones), Chromium evicts **whole origins** LRU-style. That deletes models **and the IndexedDB holding unsynced meetings** together. Whether `navigator.storage.persist()` is granted in Android WebView is unclear: older Chromium threads say WebView lacked the engagement heuristics; a later Intent to Ship claims all Blink platforms (LOW/conflicting, test on device).
- Unpinned HF URLs (`resolve/main/...`) change if the repo updates. That causes a re-download, or a mismatch between cached weights and a new config.
- Adding diarization models (segmentation about 6 MB plus embedding 7-40 MB) and possibly a second WASM runtime (sherpa-onnx) adds to quota pressure.

**How to avoid:**
- An explicit **"Download for offline"** step per engine. Fetch every file the pipeline needs, verify each with `caches.match`, and show size and status. Re-verify at startup and before an offline recording starts.
- Pin model **revisions** (commit hash), or self-host model files on the same origin if size allows (Vercel Hobby bandwidth limits make this questionable; HF CDN is fine).
- Call `navigator.storage.persist()` and show `persisted()` plus `estimate()` in settings. **Never rely on IndexedDB alone for unsynced audio or transcripts in the app.** Mirror unsynced meetings to native app storage through `Filesystem` (`Directory.Data`), which the OS does not evict.
- Keep an engine fallback: if Whisper is not cached offline, use the cached Moonshine and say so.

**Warning signs:**
Works offline the day after setup, fails a week later. `estimate().usage` drops suddenly. Model "loading…" appears in airplane mode.

**Phase to address:** P-Offline (models plus local store), P-Diar (extra models)

---

### Pitfall 8: Sync duplication and lost updates

**What goes wrong:**
- `Meeting.id` is a server `cuid()`. Offline meetings need IDs before the server sees them. If the client creates a temp ID and the server assigns a new one, a retry after a timeout (the request succeeded but the response was lost) creates **duplicate meetings**.
- **Two writers exist in the app.** The native `RecordingService` autosaves to the server by itself, and the new web IndexedDB sync will also write. Both may push the same meeting and race.
- `transcriptTail { from, parts }` uses offset replace (`slice(0, from) + parts`). That is idempotent for retries, but **stale writers can truncate**: an old queued PATCH with a smaller `from` replays after a newer one and wipes later parts. Edits to the title or minutes on the server (another device) while a phone holds an offline copy get overwritten with last-write-wins.
- A 401 while syncing (session expired) is treated as failure and the queue is dropped, or retried forever.

**How to avoid:**
- Generate **client UUIDs** (`crypto.randomUUID()`) and make create an upsert keyed by that ID (`PUT /api/meetings/:id`, or accept a client `id` on POST). Change the Prisma `id` default to allow client-supplied IDs.
- Add a monotonically increasing `rev` / `updatedAt` precondition per meeting and reject or merge stale PATCHes (`If-Match`-style). Separate the append-only transcript from editable fields (title, document).
- Make one owner per meeting: if the native service owns a recording, the web store mirrors it read-only until it finishes.
- Keep the sync queue persistent and serialised per meeting. On 401, pause the queue and prompt login; never discard.
- Show sync state per meeting ("On this phone only", "Syncing", "Synced").

**Warning signs:**
Two copies of the same meeting in the list. The transcript gets shorter after reconnecting. Minutes vanish after a phone comes online.

**Phase to address:** P-Offline (sync design, needs deeper research)

---

### Pitfall 9: Diarization that is too slow, too memory-hungry, or inconsistent across a long meeting

**What goes wrong:**
- **Memory:** holding meeting audio as Float32 at 16 kHz takes 64 KB/s, about **230 MB/hour and 2.3 GB for 10 hours**. Batch "diarize the whole file" (the sherpa-onnx offline diarization API, the pyannote pipeline) will crash the WebView tab on a 3-4 GB phone well before the 10-hour meetings this app supports.
- **Speed:** pyannote-style segmentation plus embedding plus clustering runs at roughly real-time ×(0.05-0.3) on desktop WASM (LOW, no browser benchmark found). On a low-end phone it competes with Moonshine and Whisper for the same cores. Running both live makes the transcriber fall behind (the code already has `slowRtf` fallback logic for this).
- **Inconsistent IDs:** pyannote segmentation 3.0 alone gives local speaker labels per 10 s window (up to 3 speakers). Without embeddings plus global clustering, "Speaker 1" in minute 2 is not "Speaker 1" in minute 40. Demo projects (Xenova's whisper-speaker-diarization) that use segmentation only look fine on 30 s clips and fail on meetings.
- **Unknown speaker count:** agglomerative clustering needs a threshold. Too low splits one person into 5 speakers. Too high merges everyone. Phone mics in a room, distance and noise make this worse than benchmarks (published DER around 12-15% is for curated datasets; expect much worse in the far field).
- **Two runtimes:** sherpa-onnx WASM brings its own runtime and memory alongside onnxruntime-web from Transformers.js, roughly doubling WASM heap. The sherpa-onnx WASM build may not be threaded or COEP-friendly in the same way.
- **Alignment:** attributing words to speakers needs timestamps. Moonshine output in this app is per VAD chunk, and Whisper word timestamps in Transformers.js need specific exports. A VAD chunk containing a quick turn change gets one label.

**How to avoid:**
- Design **streaming/incremental** diarization: per VAD chunk (the `voiceChunker` already segments speech), compute one speaker embedding (a small WeSpeaker/3D-Speaker/CAM++ ONNX model through the **same** onnxruntime-web instance), and assign it to the nearest centroid with online clustering. Keep only embeddings (about 256 floats per chunk), never the full audio, in memory.
- Optionally run a **re-clustering pass after the meeting ends** over the stored embeddings (cheap) to fix early mistakes. Let users rename or merge speakers ("Speaker 2 is Priya", merge 3 into 1). This is the UX safety net every commercial tool has.
- Run diarization at lower priority: after transcription of a chunk, skipped if the transcriber's real-time factor is behind, and caught up later.
- Benchmark on the Xiaomi phone early (P-Diar spike): embedding time per chunk, peak memory, and speaker count accuracy on a real 30-minute 3-person recording.
- Keep diarization optional per meeting ("Detect speakers", on by default only on fast devices).

**Warning signs:**
WebView crashes or reloads after about an hour (OOM). Speaker counts like 7 for a 2-person meeting. Live captions lag further behind when diarization is on.

**Phase to address:** P-Diar (needs a spike and deeper research before committing)

---

## Moderate Pitfalls

### Pitfall 10: Overlapping speech and short turns
**What goes wrong:** Embeddings from chunks with two people talking land between centroids and create phantom speakers or flip labels. "Yeah", "ok" and other short backchannels (<1 s) give unreliable embeddings.
**Prevention:** Skip embedding for chunks under about 1-1.5 s and inherit the previous or nearest label. If the pyannote segmentation powerset reports overlap, attribute the chunk to the dominant speaker. Do not try to separate overlapped speech on-device. Document it as a limitation, and remember Deepgram cloud remains the accurate option.
**Phase:** P-Diar

### Pitfall 11: `navigator.onLine` lies
**What goes wrong:** `true` on Wi-Fi without internet, captive portals, a VPN that has dropped, or a network that is up but very slow. `false` is reliable, `true` is not. In the WebView it reflects the Android network state. Deepgram then gets enabled and fails after the user taps Record; AI minutes hang.
**Prevention:** Combine `navigator.onLine` with a **reachability probe**: `fetch('/api/health', { cache: 'no-store' })` with a 3-5 s `AbortController` timeout, rechecked on `online`/`offline` events and every 30-60 s while visible. Treat any fetch failure from a real call as an offline signal. Gate on "reachable", not "online". For Deepgram, check `/api/deepgram` token issuance as the real test, and keep the native backlog fallback for drops mid-meeting. The native service already reports `online`; reuse it in the app.
**Phase:** P-Gate

### Pitfall 12: next-auth sessions offline
**What goes wrong:** `useSession()` in `AppShell` refetches on focus and visibility. Offline, `/api/auth/session` fails, which logs `CLIENT_FETCH_ERROR` and can flip the status to `unauthenticated`. Any `required: true` or client redirect then bounces to `/login`, which is not cached, and the user is locked out of their own offline meetings (MEDIUM, v4 behaviour from training data; verify). JWT sessions expire (default 30 days). A user offline for weeks then has queued meetings and an expired cookie.
**Prevention:** Cache a minimal "last known user" (id, email) locally. Treat a session-fetch **network error** as "unknown, keep the cached user", and only treat a real 200 with an empty session as signed out. Key IndexedDB data by `userId` so a different login on the same phone never sees or uploads someone else's meetings. On 401 during sync, ask to sign in and keep the data. There is no middleware/`proxy.ts` today. If one is added, remember it never runs offline and must not be the only auth gate the SW shell depends on.
**Phase:** P-Offline, P-Gate

### Pitfall 13: Android back button kills an in-progress web recording
**What goes wrong:** Without `@capacitor/app`, Capacitor's default is `webView.goBack()` if possible, otherwise finish the activity. From the record screen with no history (cold start), back **exits the app**. A Moonshine/Whisper recording running in the WebView then dies. The native Deepgram service survives. Once you add an `App.addListener('backButton')`, the default is disabled and you must handle exit yourself, or back does nothing. Android 13+ predictive back (`enableOnBackInvokedCallback`) can change this behaviour on newer targets.
**Prevention:** Add `@capacitor/app`. In the handler: if recording, show "Recording continues, go to background?" and call `App.minimizeApp()`, never `exitApp()`. If a sheet, modal or menu is open, close it. If `canGoBack` and not on home, `router.back()`. On home, minimize. Guard with `isPluginAvailable('App')` for old APKs (Pitfall 3). Test with gesture navigation on MIUI/HyperOS, which handles back differently from 3-button navigation.
**Phase:** P-Nav

### Pitfall 14: Back arrows using `router.back()` with no history
**What goes wrong:** A deep link or cold start into `/meetings/[id]` (from a share, or after a redirect from `/login` with `router.replace`) has no in-app history. `router.back()` leaves the app or does nothing. A brand link `<Link href="/">` during recording navigates away and unmounts the recorder hooks.
**Prevention:** Back arrows go to the **explicit parent route** (`/meetings/[id]` to `/meetings`, `/meetings` to `/`). Use `router.back()` only when an in-app history marker exists. Keep the recorder state in a layout-level provider (or native) so navigation does not unmount an active recording, or confirm before leaving. Make sure every nav target is part of the offline shell (Pitfall 5).
**Phase:** P-Nav (coordinate with P-Offline)

### Pitfall 15: Motion that slows transcription and drains battery during recording
**What goes wrong:** Live on-device inference already uses most CPU cores. Adding JS-driven animation (spring libraries updating React state each frame), animated `backdrop-filter`/blur/large shadows, animated gradients, and React re-rendering the whole Recorder for a 60 fps level meter steals main-thread time and GPU. On a budget Xiaomi phone this causes **thermal throttling**, the model's real-time factor rises, and `slowRtf` downgrades the model mid-meeting. It also costs battery in 2-10 hour meetings.
**Prevention:**
- Animate only `transform`/`opacity` with CSS or the Web Animations API. Avoid animating `filter`, `backdrop-filter`, `box-shadow`, `width`/`height`, or gradients.
- Drive the level meter by writing a CSS variable or transform through a ref in `requestAnimationFrame`, not React state. Cap at about 30 fps.
- Add a **"recording mode" calm state**: when recording, cut ambient and decorative motion, keep only the status meter. Pause all animation when `document.visibilityState === 'hidden'`.
- If a motion library is used (Motion/`motion/react`), lazy-load it and use `LazyMotion` plus `domAnimation` to limit bundle size. Each extra KB also has to be precached for offline.
- Measure: record 10 minutes with and without the new UI on the phone. Compare RTF and `threads`, and use Chrome DevTools Performance over `chrome://inspect`.
**Phase:** P-UI

### Pitfall 16: Ignoring `prefers-reduced-motion`, or assuming the WebView reports it
**What goes wrong:** Users who turned on "Remove animations" still get motion. Or the team assumes the media query works in the WebView and never tests it. (Chrome Android maps the system setting. Android WebView support and its MIUI mapping are LOW confidence; verify on device.)
**Prevention:** Wrap all motion in `@media (prefers-reduced-motion: no-preference)` (Tailwind `motion-safe:`) and use `useReducedMotion()` in JS. Also offer an in-app "Reduce motion" toggle that sets a root class, since the OS signal may not reach the WebView. Test with Developer options > animation scale set to off and Accessibility > Remove animations.
**Phase:** P-UI

### Pitfall 17: Web Share API assumed to exist in the app
**What goes wrong:** `MeetingView` sets `canShare = !!navigator.share`. **Android WebView does not implement `navigator.share`** (community reports cite Chromium bug 765923; MEDIUM, several sources agree, no official statement found). In the app the Share button is hidden or fails. On desktop, `navigator.share` exists in Chrome and Edge on Windows, but `files` support varies. Firefox desktop lacks it. Calling `share()` outside a user gesture (for example after an `await` that takes long, such as PDF generation) throws `NotAllowedError`.
**Prevention:** Use `@capacitor/share` natively (Pitfall 1). On web, check `navigator.canShare({ files: [file] })` before offering a file share and fall back to text share, then download. Build the file **before** the tap (pre-generate when the export menu opens), or re-prompt with a "Share now" button after generation, so `share()` runs within the transient user activation. Treat `AbortError` as a cancel (already done).
**Phase:** P-Export

### Pitfall 18: Gating UI that disables things without explaining, or gates too late
**What goes wrong:** The Deepgram engine shows as selectable offline, and the meeting fails at start. "Generate minutes" spins forever offline. A meeting recorded offline never gets minutes because nobody remembers to come back.
**Prevention:** Use one `useConnectivity()` source (Pitfall 11). Disabled controls carry inline text ("Needs internet: uses Deepgram cloud"). Offer "Generate minutes when back online", a queued intent stored with the meeting and processed by the sync worker. If Deepgram drops mid-meeting, switch to on-device or native backlog automatically and annotate the transcript gap.
**Phase:** P-Gate

---

## Minor Pitfalls

### Pitfall 19: `errorPath` / first-run offline
**What goes wrong:** On first install with no network, there is no SW yet, so Capacitor shows `mobile/www/index.html`. Users think offline mode is broken. After the SW exists, the errorPath page is still shown when the WebView's main-frame load fails before the SW answers (for example, the SW was evicted).
**Prevention:** Update `mobile/www/index.html` to say "Open the app once with internet to enable offline mode". Add a retry button that reloads `server.url`. Longer term, consider bundling the app shell into `webDir`, but that is a bigger architecture change; flag it for P-Offline research.

### Pitfall 20: Share filenames and MIME types
**What goes wrong:** Titles with `/ : ? *`, emoji, or Devanagari break `Filesystem.writeFile` paths or show up garbled in WhatsApp. A wrong MIME type (`application/msword` for HTML) makes receivers mislabel the file. The cache directory fills up with old exports.
**Prevention:** Slugify filenames (keep Unicode letters, strip path characters, limit to about 80 characters). Use correct MIME types. Delete export files older than a day from `Directory.Cache` at startup.

### Pitfall 21: Speaker numbering mismatch between engines
**What goes wrong:** Deepgram speakers are 0-based integers. If on-device diarization uses 1-based or different semantics, `TranscriptView` and the minutes prompt show "Speaker 0" or off-by-one names. Mixed meetings (Deepgram dropped to on-device) merge two numbering spaces.
**Prevention:** Define one convention in `src/lib/transcript.ts` (stored 0-based, displayed 1-based) and a per-meeting speaker-name map. Tag the parts' source engine.

### Pitfall 22: The SW update loop breaks the developer workflow
**What goes wrong:** Testing on the phone against `http://192.168.x.x:3001` means no SW (no secure context, and registration is production-only), so offline behaviour is only seen on Vercel builds. Stale SWs on the phone confuse testing.
**Prevention:** Add a hidden debug screen with SW version, cache sizes, a "clear caches" button, `crossOriginIsolated` and thread count. Test offline with `adb reverse` to `localhost` (a secure context) on a production build (`next build && next start`).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| P-Export: TXT/Word | Blob anchor ignored by WebView (1) | Filesystem (Cache, base64, no encoding) plus Share plugin; web fallback chain |
| P-Export: PDF | oklch crash, `.save()` download, canvas limits, fonts (2) | Text-based PDF from data, or isolated html2pdf `.outputPdf('blob')`; test with a long Hindi transcript |
| P-Export: share | No `navigator.share` in WebView; user-activation loss (17) | `@capacitor/share`; pre-generate the file before the tap; `canShare({files})` |
| Any native plugin | Old APKs lack it (3) | `isPluginAvailable` guards; "update app" prompt; ship APK first |
| P-Nav | Back exits app mid-recording (13); `router.back()` with no history (14) | `@capacitor/app` handler with `minimizeApp`; explicit parent routes |
| P-Offline: shell | SSR auth pages, RSC fetches, redirects, build skew (5) | Client-rendered shells, Serwist precache, never cache redirects |
| P-Offline: isolation | Lost COOP/COEP from the SW or Capacitor proxy (6) | Re-add headers in the SW; monitor `crossOriginIsolated` and threads |
| P-Offline: models | Lazy cache, eviction, unpinned revisions (7) | Explicit "Download for offline", `persist()`, pinned revisions, native file mirror |
| P-Offline: screen off | On-device engines stop on lock (4) | Native PCM capture plus catch-up; decide at roadmap time |
| P-Offline: sync | Duplicates, stale tail truncation, two writers, 401 (8) | Client UUID upsert, revision preconditions, single owner, persistent queue |
| P-Offline/P-Gate: auth | `useSession` offline flips to signed out (12) | Cached user; network error is not a sign-out; data keyed by userId |
| P-Gate | `navigator.onLine` false positives (11); unexplained disabling (18) | Reachability probe; inline reasons; "when back online" queue |
| P-Diar | OOM, slowness, inconsistent IDs, threshold tuning (9); overlap (10) | Incremental per-chunk embeddings plus online clustering; rename/merge UI; device spike first |
| P-UI | Motion throttles the CPU during inference (15); reduced motion (16); CDN assets vs COEP (6) | transform/opacity only; calm recording mode; `motion-safe`; in-app toggle; self-host assets |

## Recommended Research Flags

- **P-Offline needs deeper research:** Serwist plus Next 16 Turbopack setup, how to restructure SSR auth pages into offline shells, and RSC request handling offline. Also decide between screen-off native capture and on-device catch-up.
- **P-Diar needs a spike:** choose between sherpa-onnx WASM and an embedding model on the existing onnxruntime-web, then measure on the Xiaomi phone. No browser benchmarks were found.
- **P-Export, P-Nav, P-Gate:** standard patterns; low research need beyond verifying plugin APIs.
- **P-UI:** design research is separate. The pitfall work is performance budgets and testing.

## Sources

- Repo code read directly (HIGH): `src/components/MeetingView.tsx` (download/html2pdf/share), `public/sw.js`, `src/app/page.tsx` and `src/app/meetings/*` (`getServerSession` + `redirect`), `src/app/api/meetings/[id]/route.ts` (`transcriptTail` offset merge), `prisma/schema.prisma` (`cuid()` id), `next.config.ts` (COOP/COEP), `src/lib/nativeRecorder.ts`, `RecordingService.java` (Deepgram-only native path, `AudioBacklog`), `public/ort/` (14 MB threaded wasm).
- Capacitor 8 Android sources in `node_modules/@capacitor/android` (HIGH): `Bridge.java` (`addDocumentStartJavaScript`, `resolveServiceWorkerRequests` default true), `WebViewLocalServer.handleProxyRequest` (HTML proxy uses default headers).
- [Capacitor Share API docs (v8)](https://capacitorjs.com/docs/apis/share): files from the cache folder by default, `file_paths.xml` for other folders (HIGH)
- [Capacitor SW + server.url bridge issue](https://lightrun.com/answers/ionic-team-capacitor-bug-service-worker-serverurl-not-injecting-capacitor), [Ionic forum: plugins not working through SW](https://forum.ionicframework.com/t/plugins-not-working-through-service-worker/220588): historical issue, mitigated in Capacitor 8 per source (MEDIUM)
- [ProAndroidDev: blob downloads in Android WebView](https://proandroiddev.com/blob-downloads-not-working-in-android-web-view-heres-the-real-fix-243144a2a426), [Ionic forum: downloading files with Capacitor](https://forum.ionicframework.com/t/why-is-there-no-clear-guide-on-downloading-files-with-capacitor/216789) (MEDIUM)
- [Capacitor discussion #3213: WebView and Web Share](https://github-redirect.dependabot.com/ionic-team/capacitor/discussions/3213), [B4X: Web Share not supported in WebView](https://www.b4x.com/android/forum/threads/web-share-api-not-support-in-webview.149006) (MEDIUM)
- [Capawesome file handling guide](https://capawesome.io/docs/blog/capacitor-file-handling-guide/): base64 writeFile, no encoding for binary (MEDIUM)
- [html2canvas #3269 oklch](https://github.com/niklasvh/html2canvas/issues/3269), [html2canvas-pro](https://www.npmjs.com/package/html2canvas-pro) (MEDIUM)
- [Serwist Turbopack docs](https://serwist.pages.dev/docs/next/turbo), [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) (MEDIUM)
- [MDN StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [Chromium durable storage thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/5Sihi1iAXYc/m/SISKuRppAwA) (LOW for WebView specifics, sources conflict)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [OpenWhispr local diarization write-up](https://openwhispr.com/blog/local-speaker-diarization), [LocalAI diarization docs](https://localai.io/features/audio-diarization/index.html) (LOW-MEDIUM; no browser benchmarks found)
- Training data (LOW, verify): next-auth v4 `useSession` offline behaviour, `prefers-reduced-motion` in Android WebView, mobile canvas size limits.
