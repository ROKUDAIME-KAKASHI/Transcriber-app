# Phase 1: Export, Share & Navigation - Research

**Researched:** 2026-11-21
**Domain:** Capacitor 8 native plugins (Share/Filesystem/App/Network/Haptics), a custom Android print-to-PDF plugin, client-side DOCX, Next 16 App Router navigation
**Confidence:** HIGH for plugin APIs and native behaviour (read from the plugin sources), MEDIUM-HIGH for the print-to-PDF trick, MEDIUM for PDF margin details and web activation timing

## Summary

Everything this phase needs was checked against real artifacts: the published tarballs of `@capacitor/share@8.0.3`, `filesystem@8.1.5`, `app@8.1.2`, `network@8.0.1` and `haptics@8.0.2` (Java/Kotlin sources and `.d.ts`), installed `@capacitor/core@8.6.2` / `@capacitor/android@8.6.2`, the `docx@9.16.0` tarball, the Android SDK `android-36/android.jar`, and the current `MeetingView.tsx`, `AppShell.tsx`, `Providers.tsx`, `MainActivity.java` and manifest.

Most of the plan follows the locked decisions without trouble, but five facts change how tasks should be written. (1) `Capacitor.isPluginAvailable("Share")` returns **true on the plain website**, because Share has a web implementation. `hasPlugin()` therefore has to be `isNativePlatform() && isPluginAvailable(name)` for native paths. (2) Once `@capacitor/app` is in the APK, its `OnBackPressedCallback` is always enabled. With no JS `backButton` listener registered, hardware back does nothing at all: it no longer exits, and it only calls `webView.goBack()` if there is history. So `NativeBackHandler` must be mounted in the root `Providers` so it also covers `/login`, and it has to handle exit itself. (3) The Share plugin derives the MIME type from the file extension with `MimeTypeMap.getFileExtensionFromUrl`, which returns nothing for unusual characters. Keep on-disk filenames ASCII (the current `Minutes-2026-11-21.pdf` style already is). (4) Share cancel rejects with the message `"Share canceled"`, which must be treated as silent. (5) `document.referrer` and `window.history.length`, the D-12 suggestion, are unreliable for "is there in-app history" in an App Router SPA: referrer never changes on client navigation, and `history.length` counts pages from before the app. Use a tiny in-app navigation stack tracker instead.

The DocumentExport print-to-PDF plugin is a proven pattern. In the SDK stub, `PrintDocumentAdapter.LayoutResultCallback` / `WriteResultCallback` have **package-private constructors** (confirmed with `javap` on `android-36/android.jar`). The standard workaround is a two-line abstract subclass placed in an `android.print` package in app source. This is exactly what Expo's `expo-print` ships today (`PrintDocumentAdapterLayoutCallback.kt`, `package android.print`), so it runs on current Android versions. Chromium lays out the HTML and uses the system Noto Devanagari font, which gives selectable, correctly shaped Hindi text.

**Primary recommendation:** Build in this order: one platform layer (`src/lib/native.ts`, plus overlay stack, nav tracker and recording flag), then the Android `DocumentExport` plugin with a compile proof (`cap sync` + `assembleDebug`), then pure export builders (txt / print-HTML / docx via mdast), then one `deliver()` function. Wire the UI last. Every native call goes through `native.ts` and has a web or "update the app" fallback.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
- Offline detection UI / gating using Network plugin - Phase 3
- Aurora Ink restyle, motion, haptic polish - Phase 5
- "Save to Downloads" (MediaStore) - not in v1
- iOS native build - out of scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | TXT export saves/opens in APK and web | `deliver()` native path: Filesystem.writeFile (base64, Cache, no `encoding`) → Share.share({files}). Web: download or `navigator.share`. See Patterns 2-3 |
| SHARE-02 | Real .docx in APK and web | `docx@9.16.0` (fully bundled ESM, no Node imports, `Packer.toBlob`), mdast mapper (Pattern 5). Complex-script font and `hi-IN` language set in document defaults |
| SHARE-03 | PDF incl. long + Hindi, no "Couldn't make the PDF" | Native: DocumentExport plugin (Pattern 4, `android.print` callback shim as in expo-print). Web: srcdoc iframe + print. html2pdf.js removed |
| SHARE-04 | Native share sheet (APK) / Web Share (web) with download fallback | SharePlugin source behaviour (MIME from extension, `"Share canceled"` reject, `ACTION_SEND` + FileProvider `${applicationId}.fileprovider` already in manifest). Web `canShare({files})` → share → download |
| SHARE-05 | Older APKs without plugins keep working | `hasPlugin = isNativePlatform() && isPluginAvailable(name)` (web impls make `isPluginAvailable` true on web). Plugin headers come from the native side, so old APKs report false |
| NAV-01 | Brand → Record from anywhere | `Logo` already `href="/"` in both bars. Only the hit area changes (UI-SPEC §4) |
| NAV-02 | Back arrow works with no history | In-app nav stack tracker (Pattern 6), not referrer/history.length. `href="/meetings"` kept for no-JS / middle-click |
| NAV-03 | Android back: sheets → back → minimize while recording | AppPlugin source: an enabled callback swallows back when no listener exists. Handler in root Providers. Recording flag = web Recorder flag OR `MeetingRecorder.getState().active` (Pattern 7) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Keep the stack: Next.js 16 App Router + Tailwind v4 + Capacitor 8. No rewrite.
- Never print `.env*` / keystore secrets (`android/keystore.properties`). Keys stay server-side.
- No Vercel deploys, no public tunnels, no push.
- C: drive nearly full (12 GB free measured): no emulators or big downloads. The Gradle build will download the Kotlin toolchain and `ionfilesystem-android` once (tens of MB, acceptable).
- Must keep working as a plain website (laptop browsers) as well as in the APK.
- Work through GSD commands. Implementation on Sonnet.
- STACK.md "What NOT to use": no `navigator.share` as the app path, no `<a download>` in the APK, no html2pdf.js, no HTML-as-.doc.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build TXT / print-HTML / DOCX bytes | Browser (pure TS builders in `src/lib/export`) | — | All data is already in `MeetingData` on the client. Works offline |
| Build PDF | Android native (DocumentExport plugin, Chromium print) | Browser (iframe `print()` on web) | Only native gives a file without a dialog, and the WebView has no `window.print` |
| Deliver file (share/save) | Android native (Filesystem + Share) | Browser (Web Share / anchor) | WebView has no download handler and no `navigator.share` |
| Plugin capability detection | Browser (`src/lib/native.ts`) | Native plugin headers | Web code ships independently of the APK |
| Back arrow / brand link | Browser (Next router) | — | Pure client routing |
| Hardware back | Android native (AppPlugin `OnBackPressedCallback`) → Browser handler | — | Native forwards the event and JS decides |
| Recording-in-progress signal | Browser (Recorder flag) + Native (`RecordingService.active` via `MeetingRecorder.getState`) | — | Native recording outlives the `/` page |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor/share` | 8.0.3 (published 2026-11-20) | Android chooser with `files: [file://…]` | Official Ionic plugin. WebView lacks Web Share [VERIFIED: npm registry + plugin source] |
| `@capacitor/filesystem` | 8.1.5 (2026-11-09) | Write export to `Directory.Cache`, `readdir`/`deleteFile` for cleanup | Official. Kotlin, depends on `io.ionic.libs:ionfilesystem-android:1.1.1` + kotlinx-coroutines [VERIFIED: tarball build.gradle] |
| `@capacitor/app` | 8.1.2 (2026-11-20) | `backButton`, `minimizeApp`, `exitApp` | Official, uses AndroidX `OnBackPressedDispatcher` (predictive-back safe) [VERIFIED: AppPlugin.java] |
| `@capacitor/network` | 8.0.1 (2026-11-20) | Installed and wrapped only (Phase 3) | Adds `ACCESS_NETWORK_STATE` (already in manifest) [VERIFIED] |
| `@capacitor/haptics` | **8.0.2** (2026-11-20, latest 8.x) | Installed and wrapped only (Phase 5) | Adds `VIBRATE` permission via manifest merge [VERIFIED: plugin manifest] |
| `docx` | 9.16.0 (2026-11-19) | Real .docx, `Packer.toBlob` | Bundled single-file ESM (`dist/index.mjs`, ~1 MB unminified, no external imports), so it must be lazy-loaded [VERIFIED: tarball] |
| `mdast-util-from-markdown` / `mdast-util-gfm` / `micromark-extension-gfm` | 2.1.0 / 3.1.0 / 3.0.0 | Parse minutes markdown to mdast | **Already installed transitively** (react-markdown / remark-gfm). Add as direct deps at the same exact versions so they are not phantom deps [VERIFIED: npm ls] |
| `@types/mdast` | 4.0.4 (installed transitively) | Types for the mapper | Add as direct devDependency [VERIFIED: node_modules] |

### Supporting / existing
| Library | Version | Purpose |
|---------|---------|---------|
| `@capacitor/core` | 8.6.2 | `Capacitor.isNativePlatform`, `isPluginAvailable`, `registerPlugin` (DocumentExport) |
| lucide-react | existing | Icons per UI-SPEC (`ClipboardList`, `Copy`, `Share2`, …) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| mdast → docx mapper (locked D-02) | `docx/html` `htmlToContent()` (new subpath in docx 9.16) | Would map the rendered minutes HTML directly, but `dist/html.mjs` adds ~560 KB. D-02 is locked, so use mdast. Note it as a later option only |
| `android.print` callback shim | `PrintManager.print()` | Official API, but the user has to pick "Save as PDF" and then share manually. Keep it as the fallback (D-03) |

**Installation:**
```bash
npm install --save-exact @capacitor/share@8.0.3 @capacitor/filesystem@8.1.5 @capacitor/app@8.1.2 @capacitor/network@8.0.1 @capacitor/haptics@8.0.2 docx@9.16.0 mdast-util-from-markdown@2.1.0 mdast-util-gfm@3.1.0 micromark-extension-gfm@3.0.0
npm install --save-dev --save-exact @types/mdast@4.0.4
npm uninstall html2pdf.js
CAP_SERVER_URL=https://transcriber-app-ten.vercel.app npx cap sync android
cd android && ./gradlew assembleDebug
```

## Package Legitimacy Audit

slopcheck could not be run (installing it was blocked by the sandbox permission classifier). Per protocol, packages are `[ASSUMED]` for slopcheck purposes. All of them are long-established first-party packages whose sources were inspected directly in this session.

| Package | Registry | Age | Source Repo | postinstall | slopcheck | Disposition |
|---------|----------|-----|-------------|-------------|-----------|-------------|
| @capacitor/share | npm | since 2020-10 | github.com/ionic-team/capacitor-plugins | none | not run | Approved (source read) |
| @capacitor/filesystem | npm | since 2020-12 | github.com/ionic-team/capacitor-filesystem | none | not run | Approved |
| @capacitor/app | npm | since 2020-11 | github.com/ionic-team/capacitor-plugins | none | not run | Approved |
| @capacitor/network | npm | since 2020-10 | github.com/ionic-team/capacitor-plugins | none | not run | Approved |
| @capacitor/haptics | npm | since 2020-09 | github.com/ionic-team/capacitor-haptics | none | not run | Approved |
| docx | npm | since 2016-03 | github.com/dolanmiu/docx | none | not run | Approved |
| mdast-util-from-markdown, mdast-util-gfm, micromark-extension-gfm, @types/mdast | npm | years | syntax-tree / micromark / DefinitelyTyped | none | not run | Already in node_modules, so no new code enters |

**Packages removed:** none. **Flagged:** none. The planner may add a single `checkpoint:human-verify` for the install step if it wants to honour the "slopcheck unavailable" rule strictly.

## Architecture Patterns

### System Architecture Diagram

```
 User tap (PDF / Word / Text / Share menu row / Copy)
        │
        ▼
 MeetingView ExportButtons / ShareMenu ──(busy, error, copied state)──┐
        │ kind + target(minutes|transcript)                           │
        ▼                                                             │
 src/lib/export/build.ts  (pure)                                      │
   ├─ txt  → Blob text/plain;charset=utf-8                            │
   ├─ html → print HTML string (hex colours, Devanagari font stack)   │
   └─ docx → await import("docx") + mdast mapper → Blob               │
        │                                                             │
        ▼                                                             │
 src/lib/export/deliver.ts                                            │
   ├─ isNative && hasPlugin("Filesystem","Share")?                    │
   │     yes → base64 → Filesystem.writeFile(Cache/exports/…) → uri   │
   │           → Share.share({files:[uri], title, dialogTitle})       │
   │     PDF → hasPlugin("DocumentExport")? → htmlToPdf → uri → Share │
   │     no  → copy text to clipboard + "Update the app" error ───────┤
   └─ web  → PDF: srcdoc iframe → print()                             │
            file: canShare({files})? navigator.share : <a download>   │
                                                                      ▼
                                         result: ok | cancelled | error(code)

 Android back key → AppPlugin OnBackPressedCallback → JS "backButton"
   → NativeBackHandler: overlayStack.closeTop()? → stop
       : not root route? → navBack() (tracker: router.back() | push parent)
       : recording? → App.minimizeApp() : App.exitApp()
```

### Recommended Project Structure
```
src/lib/native.ts               # isNative, hasPlugin, lazy plugin getters, DocumentExport registerPlugin
src/lib/overlays.ts             # open-overlay stack (push/closeTop)
src/lib/navStack.ts             # in-app history tracker + navBack(router, parent)
src/lib/recordingFlag.ts        # set by Recorder; read by NativeBackHandler
src/lib/export/types.ts         # ExportFile {name, mime, blob} | {name, html}
src/lib/export/text.ts          # meeting → txt / transcript lines (full transcript)
src/lib/export/html.ts          # print HTML document (export stylesheet)
src/lib/export/docx.ts          # mdast → docx mapper + transcript → docx (lazy)
src/lib/export/deliver.ts       # shareOrSave(file), shareText(text), copyText(text), cleanupOldExports()
src/components/ShareMenu.tsx    # popover lg+ / bottom sheet <lg, registers in overlays
src/components/NativeBackHandler.tsx
android/app/src/main/java/android/print/PdfPrintCallbacks.java        # shim (package android.print!)
android/app/src/main/java/in/transcriber/app/export/DocumentExportPlugin.java
```

### Pattern 1: native.ts, the only place that touches plugins
```ts
// Source: @capacitor/core 8.6.2 dist/index.js (isPluginAvailable checks JS web impls first, then native PluginHeaders)
import { Capacitor, registerPlugin } from "@capacitor/core";

export type PluginName = "Share" | "Filesystem" | "App" | "Network" | "Haptics" | "DocumentExport" | "MeetingRecorder";
export const isNative = () => typeof window !== "undefined" && Capacitor.isNativePlatform();
/** True only when the INSTALLED APK has the native plugin. On web this is always false. */
export const hasPlugin = (name: PluginName) => isNative() && Capacitor.isPluginAvailable(name);

export const getShare = async () => (await import("@capacitor/share")).Share;
export const getFilesystem = async () => {
  const m = await import("@capacitor/filesystem");
  return { Filesystem: m.Filesystem, Directory: m.Directory };
};
export const getApp = async () => (await import("@capacitor/app")).App;
export const getNetwork = async () => (await import("@capacitor/network")).Network;
export const getHaptics = async () => (await import("@capacitor/haptics")).Haptics;

interface DocumentExportPlugin { htmlToPdf(o: { html: string; fileName: string }): Promise<{ uri: string }>; }
export const DocumentExport = registerPlugin<DocumentExportPlugin>("DocumentExport"); // no web impl, so hasPlugin is false on web
```
Why the `isNative()` guard is mandatory: Share, App, Filesystem, Network and Haptics all register web implementations, so `Capacitor.isPluginAvailable("Share")` is `true` in a desktop browser [VERIFIED: core source L49-55].

### Pattern 2: native file delivery
```ts
// Source: Filesystem definitions.d.ts ("If not provided [encoding], ... data as base64"; "Blob data is only supported on Web")
const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? ""); // strip "data:…;base64,"
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

async function shareNativeFile(name: string, blob: Blob, title: string) {
  const { Filesystem, Directory } = await getFilesystem();
  const { uri } = await Filesystem.writeFile({
    path: `exports/${name}`, data: await toBase64(blob), directory: Directory.Cache, recursive: true, // NO encoding
  });
  const Share = await getShare();
  try { await Share.share({ title, files: [uri], dialogTitle: "Share" }); }
  catch (e) { if (/cancel/i.test(String((e as Error)?.message))) return "cancelled"; throw e; }
  return "ok";
}
```
- Don't pass `text` together with `files`. In `SharePlugin.java`, `text` sets `text/plain` and then `shareFiles()` overwrites the type. Some targets then drop the file or the text.
- MIME type comes from `MimeTypeMap.getFileExtensionFromUrl(uri)` and falls back to `*/*`. Keep names `[A-Za-z0-9._-]` (current names are `Minutes|Report|Transcript-YYYY-MM-DD.ext`) [VERIFIED: SharePlugin.java].
- `Directory.Cache` subfolders are covered by `<cache-path path=".">` in `file_paths.xml`, and Share uses authority `getPackageName() + ".fileprovider"`, which matches the manifest. No manifest change is needed [VERIFIED].
- Only one share at a time: the plugin rejects `"Can't share while sharing is in progress"`. Disable buttons while busy (UI-SPEC already requires this).

### Pattern 3: web delivery
```ts
async function shareWebFile(name: string, blob: Blob, title: string) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return "ok"; }
    catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) throw e; // activation expired → download
    }
  }
  downloadBlob(blob, name); return "ok"; // existing anchor helper, web only
}
```
Web PDF: `const f = document.createElement("iframe"); f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0"; f.srcdoc = html; f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); }; document.body.append(f);` then remove the iframe on the iframe window's `afterprint` event or after 60 s. The web share-menu file rows should share the **Word** file, since a web PDF is a print dialog and not a Blob (see Open Question 1).

### Pattern 4: DocumentExport plugin (Java)
```java
// android/app/src/main/java/android/print/PdfPrintCallbacks.java
// Same trick as expo-print (packages/expo-print/.../PrintDocumentAdapterLayoutCallback.kt: `package android.print`).
// SDK stubs declare these constructors package-private (javap on android-36/android.jar).
package android.print;
public final class PdfPrintCallbacks {
    private PdfPrintCallbacks() {}
    public abstract static class Layout extends PrintDocumentAdapter.LayoutResultCallback {}
    public abstract static class Write extends PrintDocumentAdapter.WriteResultCallback {}
}
```
```java
// android/app/src/main/java/in/transcriber/app/export/DocumentExportPlugin.java (sketch)
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private WebView printView;            // strong ref until done, or GC kills the job
    private boolean busy;

    @PluginMethod
    public void htmlToPdf(PluginCall call) {
        String html = call.getString("html"), name = call.getString("fileName");
        if (html == null || name == null) { call.reject("html and fileName are required"); return; }
        if (busy) { call.reject("A PDF is already being made", "BUSY"); return; }
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        busy = true;
        getActivity().runOnUiThread(() -> render(call, html, safe)); // plugin methods run off the UI thread; WebView must be created on it
    }

    private void render(PluginCall call, String html, String safe) {
        File dir = new File(getContext().getCacheDir(), "exports"); dir.mkdirs();
        File out = new File(dir, safe);
        WebView wv = new WebView(getContext());
        wv.getSettings().setJavaScriptEnabled(false);  // HTML is pre-rendered; nothing to run
        wv.getSettings().setAllowFileAccess(false);
        wv.getSettings().setAllowContentAccess(false);
        wv.setWebViewClient(new WebViewClient() {
            boolean started;
            @Override public void onPageFinished(WebView v, String url) {
                if (started) return; started = true;
                // Wait until content is actually drawn (API 23+) to avoid the known "empty PDF" race.
                v.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long id) { print(call, v, out); }
                });
            }
        });
        printView = wv;
        // also: new Handler(Looper.getMainLooper()).postDelayed(timeout → reject("TIMEOUT") + cleanup, 90_000)
        wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void print(PluginCall call, WebView v, File out) {
        PrintDocumentAdapter a = v.createPrintDocumentAdapter("Transcriber export");
        PrintAttributes attrs = new PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)   // margins come from CSS @page (verify, see Pitfall 6)
            .build();
        a.onStart();
        a.onLayout(null, attrs, new CancellationSignal(), new PdfPrintCallbacks.Layout() {
            @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                try {
                    ParcelFileDescriptor fd = ParcelFileDescriptor.open(out,
                        ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                    a.onWrite(new PageRange[]{PageRange.ALL_PAGES}, fd, new CancellationSignal(), new PdfPrintCallbacks.Write() {
                        @Override public void onWriteFinished(PageRange[] pages) {
                            closeQuietly(fd); a.onFinish(); cleanup();
                            JSObject r = new JSObject(); r.put("uri", Uri.fromFile(out).toString()); call.resolve(r);
                        }
                        @Override public void onWriteFailed(CharSequence e) { closeQuietly(fd); cleanup(); call.reject("PDF write failed: " + e, "WRITE_FAILED"); }
                        @Override public void onWriteCancelled() { closeQuietly(fd); cleanup(); call.reject("PDF cancelled", "CANCELLED"); }
                    });
                } catch (IOException e) { cleanup(); call.reject("Could not open PDF file", "IO", e); }
            }
            @Override public void onLayoutFailed(CharSequence e) { cleanup(); call.reject("PDF layout failed: " + e, "LAYOUT_FAILED"); }
            @Override public void onLayoutCancelled() { cleanup(); call.reject("PDF cancelled", "CANCELLED"); }
        }, new Bundle());
    }
    // cleanup(): busy=false; if (printView != null) { printView.destroy(); printView = null; } (run on UI thread)
}
```
Register it in `MainActivity.onCreate` **before** `super.onCreate`: `registerPlugin(DocumentExportPlugin.class);`, next to `MeetingRecorderPlugin`. Local plugins are not auto-discovered: `capacitor.plugins.json` only lists npm plugins [VERIFIED: MainActivity.java, assets/capacitor.plugins.json].

Wait for `onLayoutFinished` before `onWrite`. Expo calls `onWrite` straight after `onLayout`, which works because Chromium's layout is usually synchronous enough, but waiting is the correct contract.

The fallback (D-03) is a second method `printHtml({html})`: same WebView, then `((PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE)).print(jobName, wv.createPrintDocumentAdapter(jobName), null)`. Wire it only if the device test of `htmlToPdf` fails.

### Pattern 5: mdast → docx mapper
```ts
// docx 9.16.0 d.ts: IFontAttributesProperties {ascii, cs, eastAsia, hAnsi}; ILanguageOptions {value, eastAsia, bidirectional};
// szCs defaults to size and bCs to bold (index.mjs L4193, L4217); numbering {reference, level, instance}
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
        LevelFormat, AlignmentType, ExternalHyperlink } = await import("docx");
const { fromMarkdown } = await import("mdast-util-from-markdown");
const { gfmFromMarkdown } = await import("mdast-util-gfm");
const { gfm } = await import("micromark-extension-gfm");
const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

const doc = new Document({
  styles: { default: { document: { run: {
    font: { ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI", eastAsia: "Arial" },
    size: 22,                                  // half-points = 11pt (szCs follows)
    language: { value: "en-IN", bidirectional: "hi-IN" }, // w:lang bidi = complex-script language
  } } } },
  numbering: { config: [
    { reference: "bullet", levels: [0,1,2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) },
    { reference: "ordered", levels: [0,1,2].map((l) => ({ level: l, format: LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) },
  ] },
  sections: [{ properties: { page: { margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } } }, // 18mm ≈ 1020 twips
               children: blocks(tree.children) }],
});
const blob = await Packer.toBlob(doc);
```
Map these nodes: `heading`(depth 1-3 → HeadingLevel.HEADING_1..3, sizes 36/28/24 half-points, bold), `paragraph`, `list` (ordered → "ordered" with a **new `instance` per list**, so numbering restarts; nested lists → level+1), `listItem` (its paragraphs; `checked` → "☐/☑ " prefix), `table` (header row shading `#F2F2F2`, borders `#CCCCCC`, width 100% `WidthType.PERCENTAGE`), `blockquote` (indent), `code` (monospace run), `thematicBreak` (empty paragraph with bottom border). Inline nodes: `text`, `strong`, `emphasis`, `delete`, `inlineCode`, `link` (ExternalHyperlink), `break`. Anything unknown falls back to its plain text (`toString` from `mdast-util-to-string`, already installed transitively, or a 5-line recursive helper). The transcript docx needs no markdown: one Paragraph per part, with `[mm:ss]` in a grey run and `Speaker N:` in bold when there is more than one speaker.

### Pattern 6: in-app navigation stack (NAV-02, NAV-03)
```ts
// src/lib/navStack.ts — module state, survives client navigation, resets on hard load (correct: then there is no in-app history)
let stack: string[] = [];
export function recordPath(p: string) {       // called from a tracker effect on usePathname() changes
  if (stack.at(-1) === p) return;
  if (stack.at(-2) === p) stack.pop();         // treat as back/pop
  else stack.push(p);
}
export const previousPath = () => stack.at(-2) ?? null;
export function navBack(router: { back(): void; push(h: string): void }, parent: string) {
  if (previousPath() === parent) router.back(); else router.push(parent);  // deterministic parent; never leaves the app
}
```
Mount the tracker (a `usePathname` effect) in `Providers` or in `NativeBackHandler`, so it lives across routes. The meeting back link keeps `href="/meetings"` and in `onClick` calls `e.preventDefault(); navBack(router, "/meetings")`. Parent map for the hardware back: `/meetings/[id]` → `/meetings`, and anything else that isn't root → `/`. Root routes are `/`, `/meetings` and `/login`.

### Pattern 7: NativeBackHandler
```tsx
"use client";
export function NativeBackHandler() {
  const router = useRouter(); const pathname = usePathname();
  const pathRef = useRef(pathname); pathRef.current = pathname;
  useEffect(() => { recordPath(pathname); }, [pathname]);
  useEffect(() => {
    if (!hasPlugin("App")) return;           // old APK: default Activity behaviour stays
    let handle: { remove(): Promise<void> } | undefined; let dead = false;
    void getApp().then((App) => App.addListener("backButton", async () => {
      if (closeTopOverlay()) return;
      const p = pathRef.current;
      if (!["/", "/meetings", "/login"].includes(p)) return navBack(router, p.startsWith("/meetings/") ? "/meetings" : "/");
      if (await isRecordingActive()) return void App.minimizeApp();
      void App.exitApp();
    })).then((h) => { if (dead) void h.remove(); else handle = h; });
    return () => { dead = true; void handle?.remove(); };
  }, [router]);
  return null;
}
// isRecordingActive(): webRecordingFlag || (hasPlugin("MeetingRecorder") && (await MeetingRecorder.getState({ from: 1_000_000_000 })).active)
//   from = huge → Java loop copies zero parts (MeetingRecorderPlugin.getState L107-129), so the call is cheap.
```
`Recorder.tsx` sets the web flag with `useEffect(() => setWebRecording(rec.isRecording), [rec.isRecording])` and clears it on unmount.

### Anti-Patterns to Avoid
- **`Capacitor.isPluginAvailable()` alone as the native check.** It is true on the web for plugins with web implementations.
- **`navigator.share` / `<a download>` / `window.print()` inside the APK.** None of them works in Android WebView.
- **Copying `#export-body.innerHTML` for exports.** It inherits Tailwind `oklch()` classes and for transcripts holds only the visible window. Build from data (`meeting.transcript`, `doc` markdown). For minutes HTML, render the markdown to HTML from mdast (or `renderToStaticMarkup` of `<Markdown>`) into the export stylesheet. Don't rely on prose classes.
- **Registering the `backButton` listener inside a page component.** It gets removed on navigation, and while no listener is registered back is a dead key.
- **`encoding: Encoding.UTF8` for binary.** It corrupts .docx/.pdf. Omit `encoding` and send raw base64 (no data-URL prefix).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| .docx container/XML | zip + WordprocessingML strings | `docx` Packer | Numbering, styles and content types are fiddly |
| Markdown parsing | regex | `mdast-util-from-markdown` + gfm | Tables, nested lists, emphasis edge cases |
| PDF text layout / Devanagari shaping | jsPDF/pdf-lib text drawing | Chromium print via DocumentExport | No HarfBuzz in JS PDF libs, so matras and conjuncts break |
| Share intent + FileProvider grants | custom intent plugin | `@capacitor/share` | Already handles grants, ClipData (Q+), chooser callback |
| Back-key dispatch | overriding `onBackPressed` in MainActivity | `@capacitor/app` | `onBackPressed` is not called when targeting API 36 (predictive back) |

## Common Pitfalls

### Pitfall 1: Dead back key once the App plugin ships
**What goes wrong:** `AppPlugin.load()` registers an **enabled** `OnBackPressedCallback`. Without JS listeners it only calls `webView.goBack()` when `canGoBack()`, and otherwise does nothing (no exit) [VERIFIED: AppPlugin.java L46-62].
**How to avoid:** Mount `NativeBackHandler` in root `Providers` (it covers `/login` too) and handle exit in JS. The offline `errorPath` page (`mobile/www/index.html`) has no React. Optionally add a tiny inline script there that calls `Capacitor.Plugins.App.addListener('backButton', () => Capacitor.Plugins.App.exitApp())`, or accept the dead key there.

### Pitfall 2: `hasPlugin` true on the web
See Pattern 1. Symptom: desktop tries `Filesystem.writeFile` and the web implementation writes to IndexedDB, so nothing downloads.

### Pitfall 3: Share cancel shows an error
Native rejects with `"Share canceled"` (RESULT_CANCELED while the activity didn't stop) [VERIFIED]. Web throws `AbortError`. Both must be silent (UI-SPEC).

### Pitfall 4: Web Share loses user activation
Building a docx (dynamic import + Packer) before `navigator.share` can run past the transient-activation window, which gives `NotAllowedError` [ASSUMED: Chrome window ≈ 5 s, Safari stricter]. Prefetch `import("docx")` when the share menu opens, and on `NotAllowedError` fall back to download. Clipboard writes after long awaits can fail the same way. Do the old-APK clipboard fallback **first**, synchronously in the tap, and fall back to a hidden-textarea `execCommand("copy")`.

### Pitfall 5: Empty or truncated PDF
The PDF can come out empty if it's written before the WebView has drawn (reported on the widely copied gist). Use `postVisualStateCallback`, then `onLayout`, wait for `onLayoutFinished`, then `onWrite`. Keep a strong reference to the WebView. Destroy it afterwards. Add a 90 s timeout so the JS promise never hangs.

### Pitfall 6: PDF margins/page size
Chromium (WebView) print margins come from the `PrintAttributes` min margins and/or CSS `@page` [ASSUMED]. Plan: `NO_MARGINS` in the attributes plus `@page { size: A4; margin: 18mm }` in the export CSS. If the device test shows no margin, switch to `new PrintAttributes.Margins(709, 709, 709, 709)` (mils, 18 mm) and `@page { margin: 0 }`.

### Pitfall 7: `cap sync` without `CAP_SERVER_URL`
`capacitor.config.ts` falls back to `http://192.168.100.152:3001`. Running `npx cap sync android` without the env var rewrites `android/app/src/main/assets/capacitor.config.json` (currently `https://transcriber-app-ten.vercel.app`) to the laptop IP, and the APK then opens a dead URL. Always prefix the env var, then check the JSON after syncing.

### Pitfall 8: First Gradle build needs Kotlin
`@capacitor/filesystem` is Kotlin (`kotlin_version` default `2.2.20`, kotlinx-coroutines 1.10.2, `ionfilesystem-android:1.1.1`). The Gradle cache has kotlin-gradle-plugin `2.2.21` only. Expect a one-time download. Optionally add `kotlin_version = '2.2.21'` to `android/variables.gradle` so the cached plugin is reused [ASSUMED: the root `ext` is visible to the plugin's `buildscript` `project.hasProperty`]. Java on PATH is JDK 23 and Gradle is 8.14.3. Capacitor requires Java 21 source/target, which JDK 23 can compile.

### Pitfall 9: Back arrow using referrer/history.length
`document.referrer` is fixed at hard load. `history.length` counts entries from other sites and the initial Capacitor load. Use the nav stack (Pattern 6). This refines D-12's detection method but keeps its intent.

### Pitfall 10: Unmounting a web recording
Navigating away from `/` unmounts `Recorder` (web engines die). NativeBackHandler never navigates away from `/`: at root it only minimizes or exits.

### Pitfall 11: Export HTML through the JS bridge
A 10-hour transcript is roughly 0.5-1 MB of HTML. That is fine for a single plugin call [ASSUMED]. Avoid sending the same HTML twice (for example, don't build it for the preview and again for the PDF).

## Code Examples

The export stylesheet (inline in the HTML for both the native and web PDF; hex only, per UI-SPEC §6):
```css
@page { size: A4; margin: 18mm; }
body { font-family: "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif;
       font-size: 11pt; line-height: 1.5; color: #111111; margin: 0; }
h1 { font-size: 18pt; font-weight: 600; } h2 { font-size: 14pt; font-weight: 600; } h3 { font-size: 12pt; font-weight: 600; }
.meta, .t { color: #666666; } table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #cccccc; padding: 4pt 6pt; text-align: left; } th { background: #f2f2f2; }
p, li, tr { break-inside: avoid; }
```
Wrap it in a full document: `<!doctype html><html lang="hi"><meta charset="utf-8">…`. Escape `& < > "` in every text node.

Cache cleanup (D-07), run once from Providers on native:
```ts
const { Filesystem, Directory } = await getFilesystem();
const { files } = await Filesystem.readdir({ path: "exports", directory: Directory.Cache }).catch(() => ({ files: [] }));
await Promise.all(files.filter((f) => Date.now() - f.mtime > 86_400_000)
  .map((f) => Filesystem.deleteFile({ path: `exports/${f.name}`, directory: Directory.Cache }).catch(() => {})));
```
DocumentExport also writes into `cache/exports/`, so the same sweep covers PDFs.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Activity.onBackPressed()` | `OnBackPressedDispatcher` / `OnBackInvokedCallback` | Android 16 (API 36 targets: `onBackPressed` not called, KEYCODE_BACK not dispatched) | The project targets 36, so only `@capacitor/app`'s dispatcher path is valid [CITED: developer.android.com/about/versions/16/behavior-changes-16] |
| HTML-as-.doc | Real OOXML (`docx`) | — | Proper previews in WhatsApp/Drive |
| html2pdf (html2canvas raster) | Chromium print to vector PDF | — | Selectable text, Devanagari shaping, small files |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `android.print` shim works at runtime on the user's Xiaomi (hidden-API not blocking) | Pattern 4 | Low. expo-print ships the same code. Fallback is `PrintManager.print()` |
| A2 | CSS `@page` margins are honoured by WebView print | Pitfall 6 | Cosmetic. Switch to PrintAttributes margins |
| A3 | Chrome transient activation ≈ 5 s | Pitfall 4 | Web share falls back to download, which is handled |
| A4 | `window.print()` is a no-op in Android WebView | Arch map | If it works, it is irrelevant anyway, since native uses the plugin |
| A5 | Root `ext.kotlin_version` reaches the plugin's buildscript | Pitfall 8 | An extra download only |
| A6 | slopcheck not run | Audit | Packages are first-party and their sources were read |

## Open Questions (RESOLVED)

1. **What do web share-menu rows share, given that a web PDF is a print dialog?** RESOLVED: web rows share Word (plans 01-04).
   Recommendation: on the web, "Share minutes/transcript" builds the **Word** file (description "Word file"), which UI-SPEC already allows as the fallback description. In the APK with DocumentExport present it is a PDF. In the APK without it, it is Word.
2. **D-12 detection method.** RESOLVED: nav-stack tracker (plan 01-01). Use the nav-stack tracker rather than `history.length`/referrer, which is the same intent made reliable. The planner should state this explicitly so the plan checker doesn't flag it as a deviation.
3. **Minutes HTML for the PDF.** RESOLVED: plans use a small mdast-to-HTML serializer over the same parse tree as the docx mapper (keeps react-dom/server out of the client bundle), instead of renderToStaticMarkup. Checked: `mdast-util-to-hast` 13.2.2 and `mdast-util-to-string` 4.0.0 are installed transitively, but `hast-util-to-html` is **not**. So use `react-dom/server` `renderToStaticMarkup(<Markdown remarkPlugins={[remarkGfm]}>)`, which needs no new deps). Recommended: `renderToStaticMarkup`, because it reuses exactly what the screen renders.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Android SDK | assembleDebug | ✓ | platforms 34-36.1, build-tools up to 37.0.0 | — |
| JDK | Gradle | ✓ | 23 (javap at `C:/Program Files/Java/jdk-23/bin`) | — |
| Gradle wrapper | build | ✓ | 8.14.3 (cached), AGP 8.13.0 | — |
| Kotlin Gradle plugin | @capacitor/filesystem | partial | 2.2.21 cached (plugin asks 2.2.20) | network download / pin 2.2.21 |
| Disk space | build + npm | ✓ (tight) | 12 GB free on C: | — |
| Device / emulator | PDF + back-button acceptance | ✗ (by constraint) | — | Owner tests the APK on the Xiaomi phone. Plan a human-verify checkpoint |

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation / output encoding | yes | Escape all transcript/title text into export HTML. The DocumentExport WebView runs with JS disabled and file/content access off. Sanitize `fileName` to `[A-Za-z0-9._-]` in Java (path traversal) |
| V12 Files | yes | Write only under `getCacheDir()/exports`. FileProvider grants only read, per share intent (plugin sets `FLAG_GRANT_READ_URI_PERMISSION`) |
| V2/V3/V4 | no change | Existing NextAuth. Exports use data already on the page |

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| HTML injection via a transcript into the PDF WebView | Tampering | Escape text and disable JS in the print WebView |
| `../` in fileName | Tampering | Java-side sanitize plus a fixed `exports/` dir |
| Spoofed share-chosen broadcast | Spoofing | Already nonce-validated in SharePlugin 8.0.3 |

## Sources

### Primary (HIGH)
- Tarballs `@capacitor/share@8.0.3` (SharePlugin.java), `@capacitor/app@8.1.2` (AppPlugin.java), `@capacitor/filesystem@8.1.5` (definitions.d.ts, build.gradle), `haptics@8.0.2`, `network@8.0.1` (manifests); `npm view` versions, repos and postinstall
- `node_modules/@capacitor/core/dist/index.js` (isPluginAvailable/registerPlugin); `@capacitor/android` 8.6.2 BridgeActivity
- `docx@9.16.0` tarball: `dist/index.d.ts` (font/lang/numbering/Packer), `dist/index.mjs` (szCs/bCs defaults), exports map (`docx/html`)
- `android-36/android.jar` + javap: package-private print callback constructors
- expo/expo `packages/expo-print/android/.../PrintDocumentAdapterLayoutCallback.kt` and `PrintPDFRenderTask.kt` (via GitHub API)
- Repo: MeetingView.tsx, AppShell.tsx, Providers.tsx, layout.tsx, meetings/[id]/page.tsx, MainActivity.java, MeetingRecorderPlugin.java, AndroidManifest.xml, file_paths.xml, variables.gradle, assets/capacitor.config.json, next.config.ts

### Secondary (MEDIUM)
- [Android 16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-16), [Predictive back guide](https://developer.android.com/guide/navigation/predictive-back-gesture)
- [PrintDocumentAdapter.LayoutResultCallback reference](https://developer.android.com/reference/android/print/PrintDocumentAdapter.LayoutResultCallback), [Printing HTML documents](https://developer.android.com/training/printing/html-docs)
- [brettwold gist (PdfPrint, "empty PDF" comments)](https://Gist.github.com/brettwold/838c092329c486b6112c8ebe94c8007e)

## Metadata
**Confidence breakdown:** Standard stack HIGH (registry and sources read). Architecture HIGH. Native PDF MEDIUM-HIGH (pattern proven by expo-print, still needs a device test). Margins and activation timing MEDIUM/LOW.
**Research date:** 2026-11-21. **Valid until:** about 2026-12-21 (Capacitor plugins publish often; re-check versions on install).
