---
status: pending
phase: 05-aurora-ink-redesign-release
requirements: [UI-01, UI-02, UI-03, UI-04, UI-05, REL-01]
---

# Phase 5 Human UAT: Aurora Ink redesign and release

## Prerequisites

The owner deploys the web code first. After code review the orchestrator builds `dist/Transcriber.apk` (cap sync with `CAP_SERVER_URL=https://transcriber-app-ten.vercel.app`, `gradlew assembleRelease` signed from the gitignored `keystore.properties`, then `apksigner verify`). Claude does not install the APK. Run the checks on the Xiaomi phone (APK) and a laptop browser.

## REL-01 Release APK

1. **Install (REL-01).** Install `dist/Transcriber.apk` over the old app on the Xiaomi phone. It opens the live site and stays signed in.
   result: [pending]
2. **Export (REL-01).** PDF, Word and Text of a long Hindi meeting each open correctly.
   result: [pending]
3. **Share (REL-01).** The Share pill opens the Android share sheet (WhatsApp, Drive). Copy gives the "Copied to clipboard" toast and a haptic.
   result: [pending]
4. **Offline open (REL-01).** Airplane mode, cold-start the app: Record and Meetings open, meetings are readable.
   result: [pending]
5. **Offline record (REL-01).** On-device engine records in airplane mode, saves "on this phone", then syncs with a "Synced" / "Back online" toast when the network returns.
   result: [pending]
6. **Speaker labels (REL-01).** Labels still appear (on-device and Cloud). Renaming via header chips and transcript chips works.
   result: [pending]

## UI-01 Look

7. **Theme (UI-01).** Dark theme is tinted, not black. Light theme follows the system setting. One blue accent, soft depth, glass only on tab bar, recording pill and toast. Status bar colour matches.
   result: [pending]

## UI-02 Live recording

8. **Orb and states (UI-02).** The orb reacts to voice, record morphs to stop with a live ring, the Recording label blinks, Paused is still.
   result: [pending]
9. **Calm mode (UI-02).** After 10 minutes (or screen off and back) the calm mode note shows and animation stops. A tap brings it back for about a minute. Transcription speed is unaffected compared with the Phase 4 benchmark feel.
   result: [pending]
10. **Recording pill (UI-02).** Cloud recording with the screen off, then open Meetings: the floating recording pill shows and returns to Record.
    result: [pending]

## UI-03 Motion

11. **Smoothness (UI-03).** Presses, page enter, list stagger, tab thumb, toasts and sheets animate smoothly on the phone.
    result: [pending]
12. **Reduce motion (UI-03).** Options > Reduce motion turns animations off immediately and after an app restart. The Android "Remove animations" accessibility setting also turns them off (Pitfall 16: verify the WebView reports it).
    result: [pending]

## UI-04 Screens

13. **Meetings list (UI-04).** Cards, date groups, chips (Minutes ready / On this phone / Syncing... / Couldn't sync), and the empty state on a fresh account.
    result: [pending]
14. **Meeting page (UI-04).** Share is primary, Minutes | Transcript tabs default correctly, More formats works, the AI card is gated offline with "Needs internet. We'll keep this meeting ready.".
    result: [pending]

## UI-05 Quality

15. **Layout (UI-05).** Laptop at 1280 px or wider and phone at 375-390 px, light and dark: no clipped text, nothing overlaps the floating tab bar, focus outlines are visible with the keyboard, no new controls compared with before.
    result: [pending]
16. **Plain website (UI-05).** The site still works on a laptop browser: record, export, share fallback download.
    result: [pending]

## Phase gate commands

- npm run typecheck
- npm test
- npm run build
- npm run check-build

The APK build is a post-review orchestrator step, not part of the automated gate.
