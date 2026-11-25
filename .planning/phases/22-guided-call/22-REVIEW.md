---
phase: 22-guided-call
depth: standard
status: issues_found
findings: {critical: 0, warning: 4, info: 2, total: 6}
---

# Phase 22 review

No BLOCKERs. The mid-recording swap, the stale `ended` handler, the silence-monitor teardown, exact-host matching and the unsupported-constraint fallback all hold up.

## Warnings

### WR-01: window.open without noopener; opener nulled after the fact
`src/components/GuidedCall.tsx:250-253`. `window.open(url, "_blank")` gives the new page `window.opener` and sends the app URL as Referer. `w.opener = null` runs afterwards, in a try/catch that swallows failure. It only works while the new window is still same-origin about:blank, so it is a race and not a guarantee. A call link is user-pasted or comes from a calendar event, so the opened page is untrusted. Passing "noopener" would make `window.open` return null, which would break the pop-up check.
Fix: open through a synthetic `<a href rel="noopener noreferrer" target="_blank">` click in the same user gesture. The pop-up check is lost, so keep the always-visible "allow pop-ups" hint. Or keep `window.open` and also set `referrerpolicy` on a meta tag. Do not rely on the late `w.opener = null`.

### WR-02: Silence monitor and "No call sound" run on the Phase 18A tab path regardless of the guidedCall flag
`src/hooks/useRecorder.ts:2143` (`if (tabAudio) startTabMonitor()`), `src/components/Recorder.tsx:647`. The 250 ms interval and the analyser start for every tab recording, including with `guidedCall` off. With the flag off nothing is shown, so the CPU is wasted. With it on, 18A tab users get the new warning. A real silent stretch, such as a screen-share with no talking, triggers it after 8 s. Only a sound clears it, and the check samples roughly 85 ms every 250 ms.
Fix: start the monitor (and create the analyser) only when `guided` is true. Pass `guided` into `attachTab`.

### WR-03: Cancel is only detected on the first getDisplayMedia attempt
`src/hooks/useRecorder.ts:1740-1743`. When the first call throws TypeError, the retry's error is thrown as `fail(displayMediaErrorMessage(...))` with no `code`. If the user cancels the retry picker, `shareProblem` stays null, so there is no "Try again" panel and the status line is shown as a plain message. `NotAllowedError` also covers a permissions-policy block, such as an iframe, and is reported as "Sharing was cancelled".
Fix: compute `cancelled` for the retry error too and attach the code. Optionally distinguish policy blocks.

### WR-04: Only the "no-audio" check can reject a share in browsers that don't report displaySurface, so the flow tells the user nothing there
`src/lib/guidedCall.ts:754-768`. The unknown case falls through correctly (no false kill). However, Firefox and Safari don't offer tab audio, so a guided start there always ends as "No call sound was shared" even when the picker was used correctly. The guided entry is gated on `tabCapable`, so this is probably unreachable, but the gate isn't verified in this diff.
Fix: confirm `tabCapable` excludes browsers without tab-audio support. If it doesn't, add a unit test or a guard.

## Info

### IN-01: Call links with credentials are opened
`src/lib/guidedCall.ts:829-832`. `https://user:pass@host/` passes `openableCallUrl`. Detection uses `hostname`, so `meet.google.com@evil.com` is correctly not Meet, but the link is still opened.
Fix: reject `u.username || u.password`.

### IN-02: Guided starts override source without updating the Recorder UI
`src/hooks/useRecorder.ts:2035`. `tabMode` is true for guided starts while `opts.source` is "mic". Anything in the Recorder that keys on `source === "tab"` (the speaker note, for example) won't show during a guided recording. This is unverified.
Fix: have the Recorder pass `source: "tab"` while guided is in progress, or derive the note from the active mode.

## Checked and fine
- **`reshareTab`:** the new share is attached (so it becomes current) before the old tracks are stopped. The old `ended` handler is ignored via the identity check, and `track.stop()` doesn't fire `ended` anyway.
- **Races with stop or unmount during the picker:** the `tabGraphRef !== old` and `wantRecording` re-checks stop `fresh` tracks, so nothing leaks.
- **Old share ending while the picker is open:** the recording stops and the fresh tracks are released.
- **Monitor lifecycle:** `cleanupMedia` clears the interval on stop, cancel and error. Pause resets the silence state. A wrong-surface share stops all tracks.
- **Constraints:** `{displaySurface:"browser"}` is only sent when supported, and the plain retry covers the rest.
- **Flags and phone/APK:** the guided entry needs `guidedCall && tabSelector && !nativeMode`.
- **Platform detection:** exact host or `.domain` suffix, so `meet.google.com.evil.com` does not match.

## Fixes

All six fixed in one commit (tsc, 543 tests, build and check-build pass).
- **WR-01:** call opens through a synthetic `<a rel="noopener noreferrer" target="_blank">` click in the same gesture; "allow pop-ups" hint stays; pop-up detection dropped.
- **WR-02:** `attachTab(..., monitor)` creates the analyser and `startTabMonitor` runs only for guided starts (and Share again). Phase 18A tab path has no analyser or interval.
- **WR-03:** the retry error now carries the `cancelled` code; a NotAllowedError whose message names a permissions/feature policy is no longer treated as a cancel.
- **WR-04:** `tabCapable` did not exclude Firefox/Safari. Added `guidedCallAvailable` (tab audio availability plus a Chromium UA) in `src/lib/tabAudio.ts`; the guided entry now needs it. Unit tests cover Chrome, Edge, Firefox, Safari, native, coarse pointer, no getDisplayMedia.
- **IN-01:** `openableCallUrl` rejects URLs with a user name or password (tests added).
- **IN-02:** `useRecorder` exposes `guidedRun`; Recorder shows the tab source and speaker note while a guided recording runs.
