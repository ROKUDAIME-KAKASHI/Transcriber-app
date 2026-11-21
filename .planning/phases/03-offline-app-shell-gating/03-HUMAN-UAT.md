# Phase 3 Human UAT: Offline App Shell and Gating

Run on the Xiaomi phone (APK) and a laptop browser after the next deploy (Claude does not deploy). Record pass/fail in the table at the end.

1. **Generated SW is live (OFF-01, A1).** Open https://transcriber-app-ten.vercel.app/sw.js. Expect JavaScript (the generated worker), not a 404 or HTML, and the text "asyncify" must not appear.
2. **Airplane mode cold start (OFF-01, OFF-02, A4).** In the APK sign in online, open Record, Meetings and one meeting, then close the app fully. Turn on airplane mode and cold start. Expect Record, Meetings and the meeting to render from cache, no /login redirect, no errorPath page.
3. **chrome://inspect on the phone WebView (OFF-01).** Expect the service worker registered and controlling, Cache Storage with `tr-assets-v1` and `tr-shell-*`, `self.crossOriginIsolated === true` (shells served from cache keep isolation). Note `navigator.hardwareConcurrency`.
4. **Wi-Fi connected with no internet (OFF-04).** Unplug the router uplink or use a hotspot with data off. Expect the Offline pill within about 15-30 s, gone when internet returns. Tapping it shows the explainer.
5. **Gating while offline (OFF-05).** Cloud engine disabled with "Needs internet". A saved Cloud choice falls back to on-device with the note, and is honored again online. AI Create/Regenerate disabled with "Needs internet", re-enabled automatically on reconnect.
6. **Offline model download and offline recording (OFF-06).** Download for offline for Moonshine: size about 100 MB, progress, then "Ready offline". Airplane mode, record a short meeting on-device with the screen on. Confirm it saves and syncs after reconnecting, and that the screen-on copy is honest.
7. **Android back button (OFF-02).** On /meeting with the Offline pill popover open, press back: the popover closes first, then back navigates.
8. **Update notice (OFF-01).** Deploy a second build and reopen the app: "Update ready" appears while idle. Start a recording and confirm the notice says it installs next launch and the page never reloads.
9. **Old APK (OFF-02).** An APK installed without the new plugins still loads the new web code.
10. **Sign-out and auth offline (OFF-02).** Sign-out is disabled offline. With a cached user and the server reachable but the session gone, the app goes to /login.
11. **First-ever launch offline (OFF-01).** Fresh install launched offline shows the errorPath copy (new APK only).
12. **Local-only checks not run by the executor (OFF-01, OFF-02).** Browser smoke on localhost:3001: load /login once, stop the server, reload /login and /offline from the SW; /login shows "You're offline. Sign in needs internet." with submit disabled; signed-in shells render offline with the Offline pill. See README "Testing offline locally".

## Results

| # | Pass/Fail | Notes |
|---|-----------|-------|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |

## Deferred (out of Phase 3)

- Offline first launch (no prior online visit)
- Locked-screen offline recording
- androidx.webkit cross-origin isolation allowlist spike
