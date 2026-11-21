---
phase: 01-export-share-navigation
reviewed: 2026-11-21
depth: standard
files_reviewed: 25
findings:
  critical: 0
  warning: 8
  info: 4
  total: 12
status: issues_found
---

# Phase 1: Code Review Report

No critical defects. Old APK without plugins does not crash (hasPlugin requires isNative and isPluginAvailable). Export HTML escaping and filename/path sanitization hold.

## Warnings

### WR-01: `printHtml` has no timeout, busy guard or settle guard
**File:** `android/app/src/main/java/in/transcriber/app/export/DocumentExportPlugin.java:226-274`
**Issue:** If `onPageFinished` never fires the PluginCall never resolves. Concurrent calls are unguarded; a second call destroys the previous `printView` while its print job may still read it. `onReceivedError` not handled.
**Fix:** Reuse the busy/settled/timeout pattern from `htmlToPdf`; keep `printView` until print job completes or handleOnDestroy; reject on `onReceivedError`.

### WR-02: `openFd` leaks on timeout; `onFinish` skipped on failure paths
**File:** `DocumentExportPlugin.java:81-87, 177-223`
**Issue:** `cleanup()` never calls `closeFd()`; partial output file stays; `adapter.onFinish()` only on success.
**Fix:** Call `closeFd()` in `cleanup()`, delete partial output on failure, call `adapter.onFinish()` in finally, cancel CancellationSignals on timeout.

### WR-03: Plugin state shared across calls; `busy` can leak
**File:** `DocumentExportPlugin.java:36-43, 59-67, 72-109`
**Issue:** Plain fields read/written on UI and plugin threads; a stale callback from a timed-out call can consume a new call's `settled` flag. If `getActivity()` is null, `runOnUiThread` NPEs after `busy = true`, leaving the plugin permanently BUSY.
**Fix:** Per-call `Job` object captured by callbacks, `AtomicBoolean busy`, null-check activity before setting busy or reset in try/catch.

### WR-04: `android.print` package-private shim unverified on device
**File:** `android/app/src/main/java/android/print/PdfPrintCallbacks.java:7-13`
**Issue:** May throw IllegalAccessError on some ROMs (ART checks class loader too). Handled (SHIM_FAILED -> printHtml fallback) but then the primary path is dead.
**Fix:** Verify on the Xiaomi device. If it fails, make printHtml primary.

### WR-05: `shareText` reports "ok" when it only copied
**File:** `src/lib/export/deliver.ts:184-201`
**Issue:** Falls through to `copyText` and returns "ok"; UI cannot distinguish shared from copied.
**Fix:** Add a distinct `"copied"` result and show "Copied to clipboard".

### WR-06: `isCancel` matches any message containing "cancel"
**File:** `src/lib/export/deliver.ts:45-49`
**Issue:** `/cancel/i` swallows genuine failures as silent cancellations.
**Fix:** Match exact known codes/messages (`"Share canceled"`, AbortError) only.

### WR-07: Nav-stack heuristic misreads A->B->A; overlay can be stranded
**File:** `src/lib/navStack.ts:7-15`, `src/lib/overlays.ts:12-17`
**Issue:** Navigation to `stack[length-2]` is treated as "back" even when it is a forward push, so `previousPath()` becomes wrong and `navBack` pushes duplicate history. `closeTopOverlay` pops before calling `close()`; if close does not toggle state the overlay is unregistered but still open.
**Fix:** Pop only after `close()` runs (or peek and let the overlay's cleanup unregister). Track direction via `popstate` rather than path inference.

### WR-08: `isRecordingActive` uses a magic offset and swallows errors
**File:** `src/lib/recordingFlag.ts:10-21`
**Issue:** On plugin error returns false, so back at root calls `App.exitApp()` possibly during an active recording.
**Fix:** Return true (minimize) on error/unknown state; prefer minimize over exit when uncertain. Optional: dedicated `isActive` plugin method.

## Info

### IN-01: Hard-coded `lang="hi"` on every export
**File:** `src/lib/export/html.ts:36` — detect Devanagari or omit `lang`.

### IN-02: Loose-list paragraphs concatenated; possible "Speaker NaN"
**File:** `html.ts:83-88, 126` — join paragraphs with `<br>`; guard `typeof p.speaker === "number"`.

### IN-03: `printHtmlWeb` returns "printed" before printing; 0x0 iframe may print blank
**File:** `deliver.ts:75-95` — size iframe 1x1 off-screen; surface failure if print throws.

### IN-04: Redundant `webCanShareFiles` probe; `toBase64` comma assumption
**File:** `deliver.ts:20-27, 33-43` — drop probe; guard comma index.

---
_Reviewed: 2026-11-21 | Reviewer: gsd-code-reviewer (standard depth); report persisted by orchestrator_
