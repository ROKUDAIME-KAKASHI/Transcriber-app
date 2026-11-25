# Phase 18 part A: Tab-audio capture - Summary

**Status:** Complete in code, needs UAT. **No migration** (no schema change, no new dependency, no Android change).
**Requirements:** CALL-01 (CALL-02, the meeting bot, is part B and still pending)
**Flag:** `tabAudio` (default on), Admin > Feature switches > "Record online calls from a browser tab (laptops)". Off: the selector disappears and the older "Also capture tab audio" checkbox is back, exactly as before.

## What was built

- **Audio source selector** on Record: "Microphone | Call in a browser tab" (segmented control). Shown only on laptop/desktop browsers: hidden in the Android app, on phones and tablets (user agent or `pointer: coarse`), and where `navigator.mediaDevices.getDisplayMedia` is missing. Under the tab option: an "Also record my microphone" switch (default on), the hint "Pick the Meet/Zoom/Teams tab and turn on 'Share tab audio'. Use headphones so voices aren't recorded twice." and, when the engine is not Cloud, "Speaker labels work best with Cloud". The choice is remembered on the device. Locked while recording.
- **Capture** (`useRecorder`, options `source: "tab"` and `tabMic`): `getDisplayMedia` with audio processing off and the optional hints (`preferCurrentTab: false`, `selfBrowserSurface: "exclude"`, `systemAudio: "include"`, `surfaceSwitching: "include"`; the audio options only if listed by `getSupportedConstraints()`). A `TypeError` retries with plain `{video, audio}`. The video track is stopped at once. No audio track: everything is stopped and "No tab audio was shared. Choose the call's tab and tick 'Share tab audio'." is shown. The picker opens before the microphone prompt, while the tap is fresh.
- **Mix:** tab audio (plus the mic if on) goes through a `MediaStreamDestination` (gain 1 each) on the recorder's own AudioContext into `recordStreamRef`, the single place Moonshine, Whisper and Deepgram already read from. Level meter, orb, pause/resume and wake lock are unchanged and use the mixed stream.
- **Stop sharing:** the tab audio track's `ended` event stops and saves like a normal Stop, then the status reads "Sharing stopped — recording saved".
- **Planned meetings:** a plan with a call link (from the Next-up card, or `/?plan=<id>` read from `/api/plans/<id>`) preselects "Call in a browser tab" on laptops and shows a "Join call" link (new tab, http/https only) beside the selector. Tapping Record on a Next-up call plan preselects the tab source and waits for the main Record button, so the tab picker opens from the user's own tap. Plans without a call link start as before.
- **Not stored:** the source is not saved in meeting metadata (no existing field fits without a schema change).
- **Pure helpers** `src/lib/tabAudio.ts` (capability detection, display-media options, track counting, default source, safe call URL, messages) with `tests/tabAudio.test.ts` (15 tests).

## Mic-only recording is unchanged
With the source on Microphone (the default; always in the app, on phones and with the flag off) the start path is the same code as before.

## Limits
- Deepgram diarizes the mix; on-device diarization is unchanged and works less well on a mix.
- Tab audio only exists in Chromium browsers (Chrome, Edge). Firefox and Safari hide the option or cannot share tab audio.
- Assumed, to confirm in UAT: stopping the video track right after the picker does not end the audio share in Chrome/Edge.
