# Phase 1: Export, Share & Navigation - Context

**Gathered:** 2026-11-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can export (TXT, real Word .docx, PDF) and natively share any meeting from the Android app or the website in one tap, and can always find their way back (brand link to Record, back arrow on meeting pages, correct Android back button). All native Capacitor plugins needed for the whole milestone (share, filesystem, app, network, haptics, plus a custom DocumentExport PDF plugin) land in this phase so the user sideloads one APK. Every native call is feature-detected with a web fallback so older installed APKs do not crash.

Requirements: SHARE-01..05, NAV-01..03.

</domain>

<decisions>
## Implementation Decisions

### Export pipeline
- **D-01:** One export module (e.g. `src/lib/export/`) builds `{name, mime, blob|html}` for txt/docx/pdf; UI calls a single `shareOrSave(file)` helper. Flow per STACK.md "Export / share flow".
- **D-02:** TXT = plain UTF-8 text. DOCX = real `.docx` via `docx@9.16.0`, lazy-loaded (`await import("docx")`), minutes markdown mapped through mdast (`mdast-util-from-markdown` + `mdast-util-gfm`) to headings/lists/tables/paragraphs. Replaces the fake `application/msword` .doc.
- **D-03:** PDF on Android = custom Java Capacitor plugin `DocumentExport` (`android/app/src/main/java/in/transcriber/app/export/`), `htmlToPdf({html, fileName}) -> {uri}` via off-screen WebView + print adapter writing to `getCacheDir()`. Prototype it early with long Hindi text; fallback is `PrintManager.print()` (user picks Save as PDF). PDF on web = hidden iframe + `contentWindow.print()`. `html2pdf.js` is removed from dependencies and code.
- **D-04:** Export HTML must set an explicit Devanagari-capable font stack and avoid `oklch()` colors (use plain hex/rgb in the export stylesheet). Transcript exports include the full transcript, not just the rows the view renders.

### Share behavior
- **D-05:** In the APK: `Filesystem.writeFile` (base64, `Directory.Cache`) then `Share.share({files:[uri], title, dialogTitle})`. On web: `navigator.share({files})` when `navigator.canShare({files})`, else anchor download (desktop). "Share as text" uses `Share.share({text})` native / `navigator.share({text})` web / clipboard fallback.
- **D-06:** The primary Share action opens a small menu/sheet with: Share minutes (file), Share transcript (file), Copy text. TXT / Word / PDF stay as direct save/share buttons. Native exports (TXT/Word/PDF button) go through the share sheet since the WebView cannot download; web desktop downloads.
- **D-07:** Old Cache exports (older than 1 day) are cleaned up at app start (native only, best effort).

### Plugin feature detection (SHARE-05)
- **D-08:** A single `src/lib/native.ts` wrapper exposes `isNative()`, `hasPlugin(name)` (via `Capacitor.isPluginAvailable`) and typed lazy accessors for Share, Filesystem, App, Network, Haptics, DocumentExport. No call site touches a plugin without `hasPlugin`. Missing plugin => web fallback, and for native-without-plugin show a one-line "Update the app for this" hint plus copy-to-clipboard.
- **D-09:** Pinned plugin versions per STACK.md: `@capacitor/share@8.0.3`, `@capacitor/filesystem@8.1.5`, `@capacitor/app@8.1.2`, `@capacitor/network@8.0.1`, `@capacitor/haptics` (latest 8.x, pin exact). Network and Haptics are installed and synced now but only wrapped (Haptics optionally used for button press feedback); their real use belongs to Phases 3 and 5.
- **D-10:** `npx cap sync android` and `gradlew assembleDebug` must succeed (compile proof). No device install. No Vercel deploy, no push.

### Navigation
- **D-11:** Brand link: `Logo` in `AppShell.tsx` already links to `/`; keep it and make sure it is reachable and works from every route including `/meetings/[id]`, with a >=44px touch target.
- **D-12:** Meeting page gets a visible back arrow (top-left, `aria-label="Back to meetings"`) that always navigates with `router.push("/meetings")` when there is no history (check `window.history.length`/referrer) else `router.back()`; deterministic parent is `/meetings`.
- **D-13:** Android back button via `@capacitor/app` `backButton` listener in a client `NativeBackHandler` mounted in Providers: close open sheets/modals first (a small shared open-overlay stack registry), then `router.back()`/go to parent; if at root: if recording is active, `App.minimizeApp()` instead of exit; if idle at root, `App.exitApp()`. Falls back to default behavior if plugin absent.

### Minimal UI (this phase only)
- **D-14:** Keep current neutral design; add only the share menu, back arrow, and export button wiring. Visual redesign belongs to Phase 5 ("Aurora Ink"). New UI uses existing tokens and `ui.tsx` primitives so Phase 5 restyles it for free.
- **D-15:** Errors from export/share show the existing inline error pattern with specific text; no silent failures.

### Claude's Discretion
- Exact file layout of `src/lib/export/*`, the overlay-stack registry API, markdown-to-docx mapper details, Java print-adapter implementation details, filename format (keep existing `${name}-${fileStamp()}`), menu visual details.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project planning
- `.planning/ROADMAP.md` Phase 1 - goal and success criteria
- `.planning/REQUIREMENTS.md` - SHARE-01..05, NAV-01..03
- `.planning/PROJECT.md` - constraints (no deploy, no push, no secrets)
- `.planning/research/STACK.md` - plugin versions, "Export / share flow (prescriptive)", DocumentExport plugin design, ground-truth table
- `.planning/research/PITFALLS.md` - export/share/nav pitfalls
- `.planning/research/FEATURES.md` - "Aurora Ink" direction (styling context only)
- `.planning/research/ARCHITECTURE.md` - integration notes

### Code
- `src/components/MeetingView.tsx` - current `download()`, `exportWord`, html2pdf export, `share()`, ExportBar (to be replaced)
- `src/components/AppShell.tsx` - Logo/nav
- `src/components/Providers.tsx` - mount point for NativeBackHandler
- `android/app/src/main/java/in/transcriber/app/MainActivity.java` - plugin registration
- `android/app/src/main/java/in/transcriber/app/recorder/MeetingRecorderPlugin.java` - pattern for custom plugin
- `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/file_paths.xml` - FileProvider (cache-path)
- `capacitor.config.ts`, `android/variables.gradle`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ui.tsx` primitives (Button, cx, etc.) for the share menu
- `MeetingRecorderPlugin` as the template for `DocumentExport`
- Existing FileProvider with `<cache-path>`

### Established Patterns
- Client components with `"use client"`; Tailwind v4 tokens; lucide-react icons
- Native plugin registered in `MainActivity.onCreate` via `registerPlugin`

### Integration Points
- Replace export/share handlers in `MeetingView.tsx`
- Mount back handler in `Providers.tsx`
- Register `DocumentExportPlugin` in `MainActivity`

</code_context>

<specifics>
## Specific Ideas

- Long Hindi (Devanagari) meeting as PDF is the headline acceptance test.
- Brand link and back arrow must work on a cold deep-link open of a meeting page.

</specifics>

<deferred>
## Deferred Ideas

- Offline detection UI / gating using Network plugin - Phase 3
- Aurora Ink restyle, motion, haptic polish - Phase 5
- "Save to Downloads" (MediaStore) - not in v1
- iOS native build - out of scope

</deferred>

---

*Phase: 1-Export, Share & Navigation*
*Context gathered: 2026-11-20*
