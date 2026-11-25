# Phase 22: Guided online-call recording - Summary

**Status:** Complete in code, needs UAT (see 22-HUMAN-UAT.md). **No migration** (no schema change, no new dependency, no Android change).
**Branch:** `step-8-2-guided-call` (stacked on the unmerged `step-8a-tab-audio` and `step-8-1-meeting-tabs`).

## Flag

`guidedCall` (Admin > Feature switches, default on like every flag). The entry point shows only when `guidedCall` AND `tabAudio` are on AND the existing laptop check passes (not the app, not phones or tablets, browser has screen sharing). Off means the Record screen is exactly as before. Mic recording on the web and in the APK is untouched: the new code paths run only for a tab recording.

## What was built

- **Entry point** (`GuidedCall.tsx`): a separate section under the big button, "Recording an online call?", with an optional link field and one button ("Record an online call", or "Open call and record" once a valid link is typed). Also shows when a planned meeting's call link was prefilled (Phase 13 plan prefill reuses the existing `callUrl`).
- **Picture guide** (`CallGuide.tsx`): modal with 3 steps, each with an inline-SVG mock-up of the Chrome/Edge picker (Tab option, pick your call, keep "Also share tab audio" then Share). "Don't show this again on this device" is stored in localStorage (`minutely.callGuideHidden`). The button in the guide is a real click, which the browser needs before it opens the picker. Escape, Cancel and Android back (overlay stack) close it.
- **Picker hints**: `buildDisplayMediaOptions` now also sends `video: { displaySurface: "browser" }`, but only when the browser lists `displaySurface` in its supported options; the other hints were already sent. The existing retry with a plain request on `TypeError` stays.
- **Wrong choice**: in the guided flow only, a window or whole screen share (from `track.getSettings().displaySurface`) or a share with no audio stops at once, tracks are released, no empty meeting is left, and the screen shows what to change with a **Try again** button. A cancelled picker gets the same treatment. The existing flow (Audio source selector) keeps accepting a screen share with sound as before.
- **No call sound**: while a tab is recorded, an analyser on the call audio (not the mic) is read every 250 ms. After about 8 s of near-zero loudness a non-blocking warning appears with the exact text from the brief; it clears at the first sound; the clock restarts after Pause/Resume; the recording is never stopped. Timestamps are used, so a throttled background tab only delays the warning.
- **Share again works mid-recording.** The tab audio is its own source node feeding the same mixer that every engine already reads. `reshareTab()` opens the picker (from the click), checks the new share, connects it to the same mixer, then disconnects and stops the old one. Nothing recorded is lost; only the seconds while the picker is open are missing. The old share ending is ignored (it won't count as "Stop sharing"). If the picker is cancelled or the choice is wrong, the recording carries on and the reason is shown.
- **Open the meeting from Minutely**: valid link (https only, `openableCallUrl` on top of `safeCallUrl`) opens with `window.open` in the click, then the guide appears ("Join the call there, then come back to this tab"); the user presses "Choose the call tab" to open the picker. Platform name shown for Meet, Teams, Zoom (exact host or subdomain match, so look-alike hosts are not recognised). Zoom adds: "On Zoom, choose 'Join from your browser'. The Zoom app can't be shared as a tab." A pop-up hint is shown next to the button and, if the browser blocked the tab, in the guide.
- **Source selector untouched**: the Audio source selector and the old "Join call" link still work. A guided start forces the tab source for that start only (`start("mic", { guided: true })`) and does not change the saved source choice.

## Files

New: `src/lib/guidedCall.ts`, `src/components/{GuidedCall,CallGuide}.tsx`, `tests/guidedCall.test.ts`.
Changed: `src/lib/tabAudio.ts` (displaySurface hint), `src/lib/flagsCore.ts`, `src/hooks/useRecorder.ts` (guided option, share check, silence monitor, `reshareTab`), `src/components/Recorder.tsx`.

## Tests

`npm test`: 539 pass (28 new in `tests/guidedCall.test.ts`: surface check, silence detector with thresholds and clearing, link platform detection, guide storage, display options with unsupported constraints). `npx tsc --noEmit`, `npm run build`, `npm run check-build` pass.

## Known limits

- Not tried in a real browser with a real call yet: picker behaviour (hints, `displaySurface` value, whether Edge reports it) and the silence analyser need the UAT. Where a browser doesn't report the surface, only the audio check applies.
- The picker cannot open straight after the call tab opens: the new tab takes focus, and the browser needs a click on Minutely. So there is one extra click ("Choose the call tab") by design.
- `window.open` can't tell the difference between blocked and opened when `noopener` is used, so the opener is cleared afterwards instead.
- The silence warning also runs for recordings started with the old Audio source selector (the logic is in the recorder), but it is only shown when `guidedCall` is on.
- Share again swaps the tab audio only. The mic and the engine are not restarted. If the user already clicked "Stop sharing" the recording is already stopped and saved (existing behaviour).
- The guide mock-ups are stylised drawings, not screenshots, so button names can differ slightly between Chrome and Edge versions (copy says "Chrome Tab" or "Tab").
