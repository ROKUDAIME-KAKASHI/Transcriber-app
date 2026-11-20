# Stack Research

**Domain:** Offline-capable meeting transcriber (Next.js 16 App Router web app + Capacitor 8 Android shell loading a remote `server.url`)
**Researched:** 2026-11-20
**Confidence:** MEDIUM-HIGH overall. Versions were checked against the npm registry today. Capacitor behaviour was checked against the Capacitor 8.6.2 Android source in `node_modules`. WebView API support was checked against MDN browser-compat-data. Phone performance numbers for diarization are estimates only (LOW).

This milestone adds to the existing app (Next 16.2.9, React 19.2.4, Tailwind v4, Capacitor 8.6.2, @huggingface/transformers 4.3.2, Prisma 6 / Neon, NextAuth 4). Nothing below replaces that core.

---

## Ground truth from the codebase (why some options are ruled out)

| Fact | Where verified | Consequence |
|------|----------------|-------------|
| **Android WebView does not support `navigator.share` or `navigator.canShare` at all** (`webview_android: version_added: false`, crbug 40540400). Chrome Android has had it since v61. | MDN browser-compat-data `api/Navigator.json` | The current `share()` in `MeetingView.tsx` can never work in the APK. Native share needs `@capacitor/share`. |
| Blob/anchor `a.download` does nothing in Capacitor's WebView because Capacitor sets no `DownloadListener` | Current behaviour in `MeetingView.tsx` `download()` | Inside the app, every export has to go through **Filesystem.writeFile (Cache) → Share.share({files})**. |
| `html2pdf().save()` also downloads through an anchor, and html2pdf.js 0.14 uses **html2canvas 1.x, which throws on Tailwind v4 `oklch()` colours** (html2canvas issue #3269, unresolved upstream) | `npm view html2pdf.js dependencies` → `html2canvas ^1.0.0`; GitHub issue | Two separate causes for "Couldn't make the PDF". Remove html2pdf.js. |
| With `server.url` set, Capacitor 8 injects the JS bridge with `WebViewCompat.addDocumentStartJavaScript(..., allowedOrigin = server.url origin)` when the WebView supports `DOCUMENT_START_SCRIPT` | `Bridge.java` L262-272 | The bridge, and so every native plugin, is injected into **any document on that origin, including pages a service worker serves from cache**. Offline pages served by the SW can still call native plugins. HIGH (from source). |
| Capacitor installs a `ServiceWorkerClient` (`android.resolveServiceWorkerRequests`, default `true`). For remote URLs with no JS injector, `handleProxyRequest` returns `null`, so the SW's requests go to the network normally | `Bridge.java` L283-293, `WebViewLocalServer.java` L210-214, L515 | Service workers on the `server.url` https origin work in the APK. If the SW answers navigations from cache, `onReceivedError` never fires, so `errorPath` (`mobile/www/index.html`) is only shown before the first successful load. HIGH (source), still needs a device test. |
| `SharedArrayBuffer` in Android WebView: `version_added: false` in BCD. Historically WebView did not support COOP-based cross-origin isolation. **androidx.webkit 1.18.0 (2026-10-21) adds `Profile#setCrossOriginIsolatedAllowlist`**. Allowlisted origins can then use SAB if the page also sends a `Document-Isolation-Policy` header. | MDN BCD; developer.android.com/jetpack/androidx/releases/webkit | Inside the APK, ONNX WASM has **probably been running single-threaded**, even though the web build is cross-origin isolated. Check `self.crossOriginIsolated` on the Xiaomi phone via `chrome://inspect`. The project pins `androidxWebkitVersion = '1.14.0'` in `android/variables.gradle`. MEDIUM. |
| Background Sync (`SyncManager`) is not supported in Android WebView | MDN BCD | Sync must run in the foreground: on app resume, on the `online` event, and on a timer. |
| OPFS (`navigator.storage.getDirectory`), `StorageManager.persist`, Service Worker and `document.startViewTransition` all mirror Chrome Android in WebView | MDN BCD | All of these are usable in the APK. |
| FileProvider `${applicationId}.fileprovider` with `<cache-path>` is already in `AndroidManifest.xml` / `res/xml/file_paths.xml` | repo | `@capacitor/share` can share files in `Directory.Cache` without changing the manifest. |
| transformers.js 4.3.2 already includes `PyAnnoteFeatureExtractor`/`post_process_speaker_diarization` **and** `WeSpeakerResNetModel` + `WeSpeakerFeatureExtractor` | `dist/transformers.web.js` | Diarization needs **no new runtime**. It runs in the existing speech worker with the existing `/ort/` WASM. HIGH. |
| transformers.js 4.x caches models in the Cache API (`transformers-cache`). With `useWasmCache` (default on) it also caches the ORT `.wasm`/`.mjs`, as long as `wasmPaths` is an object, which the worker already sets | `dist/transformers.web.js` L140-147, L8656 | Model caching for offline mostly works already. The SW must **not** cache Hugging Face requests a second time. |

---

## Recommended Stack

### Core Technologies (additions)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@capacitor/share` | **8.0.3** | Native Android (and later iOS) share sheet with `files: [fileUri]`, `text`, `title`, `dialogTitle` | Web Share is missing in Android WebView, so this is the only path to WhatsApp, Drive, Telegram and the rest. On web the plugin calls `navigator.share`, but call `navigator.share` directly on web so you can pass `File` objects (the plugin's `files` field is file:// URIs and native-only). Peer: `@capacitor/core >=8`. HIGH |
| `@capacitor/filesystem` | **8.1.5** | Write the export to `Directory.Cache` and get a `file://` URI for Share | Android shares only from the cache folder by default, and the existing FileProvider covers it. `writeFile` accepts a **base64 string** on native (Blob is web-only), so convert with `FileReader.readAsDataURL`. Exports are small (KB to a few MB), so the bridge cost doesn't matter. HIGH |
| `@capacitor/network` | **8.0.1** | Reliable online/offline status in the APK (`getStatus`, `networkStatusChange`) | `navigator.onLine` is unreliable in WebViews. This drives the gating of Deepgram and AI Minutes and the sync triggers. On web, fall back to `navigator.onLine` plus a probe fetch. HIGH |
| `@capacitor/app` | **8.1.2** | Android hardware back button (`backButton` listener → `router.back()` / `App.exitApp()`), `appStateChange` / `resume` to trigger sync | This milestone has a navigation requirement for "Android back button behaves". It is also the foreground sync trigger, since Background Sync is unavailable. HIGH |
| `@serwist/turbopack` + `serwist` | **9.5.15** (both, published 2026-11-17) | Service worker with a build-time precache manifest of every hashed `/_next/static/*` chunk, runtime caching for navigations and RSC, and an offline fallback | Next 16 builds with Turbopack by default. `@serwist/next` needs webpack (Next's own PWA guide still says "currently requires webpack"). `@serwist/turbopack` is the Turbopack route: `withSerwist()` in next.config, an `app/serwist/[path]/route.ts` route handler that builds `app/sw.ts` with esbuild, and `<SerwistProvider swUrl="/serwist/sw.js">`. Peer `next >=14`. Its docs don't name Next 16, hence MEDIUM |
| `dexie` | **4.4.7** | Local meetings DB (IndexedDB): meetings, transcript parts, minutes, an outbox of pending mutations, speaker embeddings | Gives a typed schema with versioned migrations, compound indexes and transactions over IndexedDB, and live queries. Raw `idb` makes you hand-roll migrations and reactivity. Works the same in the WebView and desktop browsers. HIGH |
| `dexie-react-hooks` | **4.4.0** | `useLiveQuery` so the meeting list and view re-render from IndexedDB | Lets offline-first UI read local data instead of server props. HIGH |
| `docx` | **9.16.0** (2026-11-19) | Real `.docx` generation client-side (`Packer.toBlob`) | Replaces the fake `application/msword` HTML `.doc`, which WhatsApp, Drive previews and Word on phones handle badly. Stores plain Unicode, so **Hindi/Devanagari renders correctly**: Word/Docs do the text shaping. Lazy-load with `await import("docx")`. HIGH |
| `mdast-util-from-markdown` + `mdast-util-gfm` (+ `micromark-extension-gfm`) | **2.1.0 / 3.1.0 / 3.0.0** | Parse AI Minutes markdown into an AST, then map it to docx paragraphs, headings, lists and tables (a ~150-line mapper) | Already in the dependency tree through react-markdown/remark-gfm, so near-zero added weight. HIGH |
| **Custom Capacitor plugin `DocumentExport` (Java, in `android/app/src/main/java/in/transcriber/app/export/`)** | n/a | `htmlToPdf({html, fileName}) → {uri}`: load the export HTML into an off-screen `WebView`, run `createPrintDocumentAdapter()`, write the PDF to `getCacheDir()` | Chromium lays out the text, so the PDF has **selectable text, correct Devanagari shaping, small files**, and the same HTML as the Word export. It follows the existing `MeetingRecorderPlugin` pattern. Writing a PDF without the print UI uses the common `android.print` package-private `LayoutResultCallback`/`WriteResultCallback` subclass trick. If that ever breaks, fall back to `PrintManager.print()`, the official API, where the user picks "Save as PDF". MEDIUM |

### Diarization (on-device, inside the existing speech worker)

| Component | Model / Version | Size (verified on HF) | Purpose | Why |
|-----------|-----------------|------------------------|---------|-----|
| Speaker embedding | `onnx-community/wespeaker-voxceleb-resnet34-LM`, **`model_int8.onnx`** (or `q8`/`quantized`) | **6.7 MB** int8 (26.5 MB fp32, 13.3 MB fp16) | 256-dim speaker embedding per voice phrase | This is the embedding model pyannote 3.x uses. It is natively supported in transformers.js 4.3.2 (`WeSpeakerResNetModel` + `WeSpeakerFeatureExtractor` with Kaldi fbank), and it runs on the already-shipped ORT WASM. HIGH that it loads. Phone speed LOW until benchmarked |
| Speaker-change detection (phase 2) | `onnx-community/pyannote-segmentation-3.0`, **`model_int8.onnx`** | **1.5 MB** int8 (6.0 MB fp32) | Frame-level powerset speaker activity over 10 s windows (up to 3 local speakers plus overlap), used to **split a VAD phrase at speaker changes** | Tiny and supported (`AutoModelForAudioFrameClassification` + `post_process_speaker_diarization`). **Its IDs are local to each window and are not global speakers**, so it never replaces embeddings plus clustering. HIGH |
| Clustering | Hand-written (≈80 LOC): **online centroid assignment for live labels** (cosine sim ≥ θ ≈ 0.5-0.6 → existing speaker, else new) **+ agglomerative (average-linkage, cosine) re-clustering at stop** with a distance threshold and an optional user "number of speakers" hint | 0 KB | Global Speaker 1/2/… labels | The math is trivial for N ≤ a few thousand phrases (10 h ≈ 3-6k phrases, an O(n²) matrix of floats is well under 150 MB, or use chunked/centroid AHC). A library isn't worth it. Thresholds need tuning on real recordings. MEDIUM |

**Pipeline (fits the existing `voiceChunker.ts`):** VAD already emits phrases of 0.3-15 s that end at about 650 ms of silence. After Moonshine/Whisper transcribes a phrase, run WeSpeaker on the same Float32 16 kHz buffer (skip phrases < ~1 s or give them low weight) and keep **only the 256-float embedding** (1 KB) in Dexie, never the audio. That way a 10-hour meeting still needs no audio storage. Live: online assignment gives provisional labels. Stop: re-cluster all embeddings and relabel the transcript. Phase 2: run pyannote segmentation on long phrases (> ~4 s) to split mid-phrase turn changes before embedding.

### UI motion

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| CSS first: Tailwind v4 `transition-*`, `@starting-style` (`starting:` variant), `@keyframes` in `globals.css`, `prefers-reduced-motion` | Tailwind ^4 (existing) | Hover/press feedback, entrance fades, recording pulse, level-meter glow, skeleton shimmer | No JS cost and runs on the compositor. Covers about 80% of the "make it feel alive" brief. HIGH |
| `tw-animate-css` | **1.4.0** | Ready-made `animate-in fade-in slide-in-from-bottom-2` utilities for Tailwind v4 | The v4-native replacement for `tailwindcss-animate`. CSS-only. Optional. HIGH |
| React `<ViewTransition>` + `experimental.viewTransition: true` | Next 16 (bundled React canary, no install) | Route transitions: list → meeting morph, directional slide for back/forward | Next's own docs (`node_modules/next/dist/docs/.../view-transitions.md`) describe it. App Router uses the React canary that ships `ViewTransition`. WebView supports `startViewTransition`. Flag is **experimental**, so it degrades to no animation. MEDIUM |
| `motion` | **14.14.0** (2026-11-13; peers react ^18 \|\| ^19) | Only where CSS can't do it: spring/gesture (swipe-to-delete, drag sheet), `AnimatePresence` exit animations, `layout` animations for live transcript lines and speaker chips | Import from `motion/react` and use `LazyMotion` + `domAnimation` + `m.*` to keep the initial cost small. Note the majors moved fast (v12 Jan 2025 → v13 Aug 2026 → v14 Oct 2026), so pin `~14.14`. HIGH for compatibility, MEDIUM for bundle-size claims |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `esbuild` **0.28.2** (dev) | Required by `@serwist/turbopack` to compile `app/sw.ts` | Peer range `>=0.25 <1`. `useNativeEsbuild: true` on Windows/Vercel. |
| `chrome://inspect` over USB (adb) | Inspect the APK WebView: SW status, Cache Storage, IndexedDB, `crossOriginIsolated`, `navigator.hardwareConcurrency` | Main verification tool for the offline and SAB questions. |
| `androidx.webkit` **1.18.0** (Gradle override in `variables.gradle`) | Only if you adopt `Profile#setCrossOriginIsolatedAllowlist` for multi-threaded ONNX in the APK | Separate, optional spike. Needs the `Document-Isolation-Policy: isolate-and-require-corp` header added next to COOP/COEP. Verify the API shape in the androidx `Profile` reference before coding. MEDIUM-LOW |

---

## Installation

```bash
# Native plugins (then: CAP_SERVER_URL=https://transcriber-app-ten.vercel.app npx cap sync android, rebuild + re-share the APK)
npm install @capacitor/share@^8.0.3 @capacitor/filesystem@^8.1.5 @capacitor/network@^8.0.1 @capacitor/app@^8.1.2

# Offline / local data
npm install serwist@^9.5.15 @serwist/turbopack@^9.5.15 dexie@^4.4.7 dexie-react-hooks@^4.4.0

# Export
npm install docx@^9.16.0 mdast-util-from-markdown@^2.1.0 mdast-util-gfm@^3.1.0 micromark-extension-gfm@^3.0.0

# Motion
npm install motion@~14.14.0 tw-animate-css@^1.4.0

# Dev
npm install -D esbuild@^0.28.2

# Remove
npm uninstall html2pdf.js
```

No new packages are needed for diarization. It uses `@huggingface/transformers@4.3.2`, which is already installed.

---

## Export / share flow (prescriptive)

```
buildExport(kind: "txt"|"docx"|"pdf") -> { blob?: Blob, html?: string, name, mime }
shareOrSave(file):
  if Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Share"):
      pdf  -> DocumentExport.htmlToPdf({html, fileName}) -> {uri}         (native, Chromium layout)
      else -> Filesystem.writeFile({path: name, data: base64(blob), directory: Directory.Cache}) -> {uri}
      Share.share({ title, text: shortSummary, files: [uri], dialogTitle: "Share minutes" })
  else if navigator.canShare?.({ files: [new File([blob], name, {type: mime})] }):
      navigator.share({ files, title })                                   (Chrome Android, Edge/Chrome Windows, Safari)
  else:
      anchor download (desktop)        ; PDF on web -> hidden iframe + contentWindow.print() (Save as PDF)
"Share as text" (WhatsApp message body): Share.share({ text }) native / navigator.share({ text }) web / clipboard fallback
```

- MIME types: `.docx` = `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.txt` = `text/plain`, `.pdf` = `application/pdf`. WhatsApp, Telegram and Drive all accept these via `ACTION_SEND`.
- APKs already installed without the new plugins: `Capacitor.isPluginAvailable("Share")` returns false. Show "Update the app" plus a copy-to-clipboard fallback. JS imports of the plugin are safe because `registerPlugin` proxies lazily.
- Clean up `Directory.Cache` exports older than a day when the app starts.

## Offline-first (prescriptive)

1. **Keep `server.url`.** Do not bundle a static export into the APK: the app uses server routes (NextAuth, Prisma, Deepgram token, AI), so `output: "export"` would mean a rewrite and a second deploy target. Rely on the SW on the Vercel origin. The source above shows it works under Capacitor, and the Capacitor bridge still injects into cached pages.
2. **Serwist precaches** all `/_next/static/*` (hashed, immutable), `/ort/*`, icons, the offline page, and **app-shell routes** (`/`, `/meetings`, `/meetings/[id]` shell). Runtime: `NetworkFirst` (3 s timeout) for navigations and RSC (`RSC: 1` header) requests. `NetworkOnly` for `/api/*`. **Exclude `huggingface.co` / `cdn-lfs*.hf.co`**, which transformers.js already caches in `transformers-cache`. Replace the existing hand-written `public/sw.js`, and keep the same scope `/` so the old one is replaced.
3. **Precached and SW-served responses must keep COOP/COEP headers.** Serwist caches the real response, headers included. Make sure the offline fallback page is served by Next (gets the `/:path*` headers), not a static file without them, or the worker loses isolation offline.
4. **Pages must render from IndexedDB on the client.** Server Components that call `getServerSession` and Prisma cannot render offline. Make the meeting list and meeting view client components that read Dexie, with the server as a sync source (an architecture concern, flagged for ARCHITECTURE.md).
5. **Sync:** client-generated `crypto.randomUUID()` meeting IDs, a Dexie `outbox` table, idempotent `PUT /api/meetings/:id` plus the existing `transcriptTail` PATCH. Flush on `Network` online, `App` resume, and every 30 s while online. No Background Sync (unsupported in WebView). Do not use Dexie Cloud (paid, a second backend).
6. Call `navigator.storage.persist()` once after login. Show the cached-model status ("Works offline ✓") from `caches.open("transformers-cache")`.
7. **Auth offline:** the NextAuth session cookie cannot be checked without the server. Keep the last-known user `{id, email}` in Dexie, so offline mode shows only that user's local meetings. Clear Dexie and caches on sign-out.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@capacitor/share` + `@capacitor/filesystem` | Native `DownloadListener` in `MainActivity` that handles `blob:` URLs | If you want "Save to Downloads" too. It's more native code and still doesn't give you the share sheet. |
| Custom `DocumentExport` print-to-PDF plugin | `jsPDF` **4.2.1** text API (no html2canvas) with an embedded Noto Sans font | Web-only PDF of **English-only** text. jsPDF does no complex-script shaping, so Hindi conjuncts and matras break (MEDIUM, consistent across PDF libs without HarfBuzz). |
| Custom print-to-PDF plugin | `html2canvas-pro` **2.6.4** + `jsPDF` 4.2.1 (raster PDF) | A quick single-code-path stopgap for **short minutes only**. It fixes oklch and renders Hindi (browser rasterizes), but the text isn't selectable, files are large, and it runs out of memory on long transcripts on phones. |
| Custom print-to-PDF plugin | `@react-pdf/renderer` **4.9.0** / `pdf-lib` **1.17.1** | Not recommended. react-pdf is heavy and has no HarfBuzz shaping (Devanagari LOW confidence). pdf-lib hasn't been released since 2022 and has no text layout. |
| `docx` + mdast mapper | `remark-docx` 0.4.0 / `@mohtasham/md-to-docx` 4.8.1 | Only if markdown fidelity needs grow. remark-docx depends on shiki, mermaid and MathJax (heavy). |
| `@serwist/turbopack` | Extend the hand-written `public/sw.js` (cache-first `/_next/static/*` at runtime, NetworkFirst navigations, a warm-up fetch of key routes after login) | If Serwist's route-handler build misbehaves on Vercel or Next 16.x. It works, but routes never visited online won't have their chunks cached. |
| `@serwist/turbopack` | `@serwist/next` 9.5.15 with `next build --webpack` | If you're already forced onto webpack. Slower builds, and it goes against the Next 16 default. |
| Dexie 4 | `idb` **8.0.4** | Tiny wrapper. Fine for 1-2 stores, but you'd hand-write migrations and change notifications. |
| transformers.js WeSpeaker (+ pyannote seg) | **sherpa-onnx** (`pyannote-segmentation-3-0` + 3D-Speaker/NeMo embeddings + built-in clustering) | The **npm `sherpa-onnx` 2.0.2 is the Node WASM build** (`sherpa-onnx-wasm-nodejs`). A browser WASM build has to come from their HF-space artefacts and brings a second ONNX runtime (MBs, its own threading). Consider sherpa-onnx's **native Android JNI** build later if on-device transcription should also run in `RecordingService` with the screen off. |
| Embedding per VAD phrase | Full pyannote pipeline over the whole recording after stop | Higher accuracy on overlapping speech, but it needs the full audio kept (16 kHz Float32 ≈ 230 MB/hour), which is not viable for 10-hour meetings on phones. |
| CSS + View Transitions + `motion` (LazyMotion) | `motion` everywhere | Only for heavily gesture-driven screens. Otherwise it adds JS to every route for effects CSS does for free. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `navigator.share` as the app path | Not implemented in Android WebView (BCD `false`) | `@capacitor/share` (native), `navigator.share` only on web |
| `<a download>` / `URL.createObjectURL` in the APK | Capacitor WebView has no download handler, so nothing happens | Filesystem (Cache) → Share |
| `html2pdf.js` 0.14 | Uses html2canvas 1.x (crashes on Tailwind v4 oklch) and saves through an anchor download | Native print-to-PDF plugin; web: `print()` |
| HTML-as-`.doc` (`application/msword`) | Not a real Word file. Previews break in WhatsApp and Drive, and Word mobile shows warnings | `docx` 9.16.0 |
| `next-pwa` / `@ducanh2912/next-pwa` | Unmaintained / webpack-only. Serwist is the successor that Next's docs point to | `@serwist/turbopack` |
| `@serwist/next` with the default Next 16 build | Requires webpack | `@serwist/turbopack` |
| Background Sync API / `workbox-background-sync` queue | `SyncManager` unsupported in Android WebView | Dexie outbox + resume/online/timer flush |
| Caching HF model URLs in the SW | Double storage (transformers.js already caches them) and quota pressure | Let `transformers-cache` own models |
| Storing raw meeting audio for diarization | GBs for long meetings | Store 256-d embeddings per phrase |
| pyannote segmentation labels used as speaker IDs | Labels are per 10 s window and reset every chunk | Embeddings + clustering for global IDs |
| `Xenova/wavlm-base-plus-sv` | 100 MB quantized / 400 MB fp32 | WeSpeaker ResNet34 int8 (6.7 MB) |
| `tailwindcss-animate` | Tailwind v3 plugin API | `tw-animate-css` |
| `framer-motion` package name for new code | Same code as `motion` (both 14.14.0). `motion/react` is the current import | `motion` |

## Stack Patterns by Variant

**Running inside the APK (`Capacitor.isNativePlatform()`):**
- Export: native PDF plugin / Filesystem + Share. Online status from `@capacitor/network`. Back button via `@capacitor/app`.
- Expect single-threaded ONNX unless the androidx.webkit 1.18 allowlist spike succeeds. Default to Moonshine Tiny/Base and run diarization embeddings after transcription per phrase (queued, never blocking ASR).

**Plain website (laptop/phone browser):**
- Export: `navigator.share({files})` where `canShare` allows, else download. PDF via a print-styled iframe.
- Cross-origin isolated (COOP/COEP already set), multi-threaded WASM, so diarization can run live.

**Offline (either):**
- Disable the Deepgram engine and AI Minutes buttons with an explanation. On-device engines and diarization keep working. Writes go to Dexie and sync later.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@capacitor/share@8.0.3`, `filesystem@8.1.5`, `network@8.0.1`, `app@8.1.2` | `@capacitor/core >=8.0.0` (project 8.6.2) | Requires `npx cap sync android` and a new APK. Old installs lack them, so feature-detect with `isPluginAvailable`. |
| `@serwist/turbopack@9.5.15` | `next >=14`, `react >=18`, `esbuild >=0.25 <1`, `typescript >=5` | Docs say Serwist 10 will need Next ≥15. Next 16 is not named explicitly in the docs (MEDIUM). Project is on next 16.2.9 (latest 16.4.6). |
| `motion@14.14.0` | `react ^18 \|\| ^19` | Fine with React 19.2.4. |
| `dexie@4.4.7` | `dexie-react-hooks@4.4.0` | Same major. |
| `docx@9.16.0` | Browser (`Packer.toBlob`) | Lazy import. Don't bundle it in the initial route. |
| WeSpeaker / pyannote ONNX | `@huggingface/transformers@4.3.2` + ORT WASM 1.2x in `/ort/` | Already-copied `ort-wasm-simd-threaded.*` serve both. `onnxruntime-web` latest is 1.31.1. Don't bump it separately from transformers.js. |
| COOP/COEP headers | Serwist runtime caching | Cached responses keep headers. The offline fallback must come from a Next route so it gets them. |
| `androidx.webkit` 1.14.0 (current) → 1.18.0 | Capacitor 8.6.2 (`implementation "androidx.webkit:webkit:$androidxWebkitVersion"`) | Bumping the variable also bumps Capacitor's dependency. Low risk, but test. |

## Sources

- npm registry (`npm view`, 2026-11-20): versions for all packages above. HIGH
- Capacitor 8.6.2 Android source in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/` (`Bridge.java`, `WebViewLocalServer.java`, `BridgeWebViewClient.java`, `CapConfig.java`): bridge injection, SW client, errorPath behaviour. HIGH
- https://capacitorjs.com/docs/apis/share: `files` are file:// URLs, native only. Android shares from the cache folder by default (file_paths.xml). HIGH
- https://capacitorjs.com/docs/apis/filesystem: Blob only on web, base64 on native, Directory enum, largeHeap note. HIGH
- MDN browser-compat-data (GitHub raw, `api/Navigator.json`, `SyncManager`, `StorageManager`, `ServiceWorker`, `Document.startViewTransition`, `SharedArrayBuffer`): WebView support matrix. HIGH
- https://developer.android.com/jetpack/androidx/releases/webkit: 1.18.0 (2026-10-21) `Profile#setCrossOriginIsolatedAllowlist` + `Document-Isolation-Policy`. MEDIUM (API surface not yet read in the reference docs)
- https://serwist.pages.dev/docs/next/turbo: `@serwist/turbopack` setup. MEDIUM
- `node_modules/next/dist/docs/01-app/.../viewTransition.md`, `view-transitions.md`, `progressive-web-apps.md` (Next 16.2.9 bundled docs): experimental flag; Serwist note "requires webpack". HIGH
- `node_modules/@huggingface/transformers/dist/transformers.web.js`: `WeSpeakerResNetModel`, `PyAnnoteFeatureExtractor.post_process_speaker_diarization`, cache env defaults. HIGH
- Hugging Face API file trees: `onnx-community/pyannote-segmentation-3.0` (int8 1.54 MB), `onnx-community/wespeaker-voxceleb-resnet34-LM` (int8 6.69 MB), `Xenova/wavlm-base-plus-sv` (quantized 101 MB). HIGH
- https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html + inspection of `sherpa-onnx@2.0.2` tarball (Node WASM build). MEDIUM
- https://github.com/niklasvh/html2canvas/issues/3269, https://www.npmjs.com/package/html2canvas-pro: oklch failure and fix. MEDIUM
- https://github.com/py-pdf/fpdf2/issues/365 and related threads: PDF libraries without HarfBuzz break Devanagari. MEDIUM for jsPDF specifically (inferred, not from jsPDF docs)

---
*Stack research for: offline-capable meeting transcriber (Next 16 + Capacitor 8 Android)*
*Researched: 2026-11-20*
