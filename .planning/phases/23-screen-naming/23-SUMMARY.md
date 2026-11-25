# Phase 23: Screenshot + voice naming - Summary

**Status:** Complete in code, **beta, off for every device until its owner opts in**. Needs the accuracy check in `23-HUMAN-UAT.md` before anyone is told to switch it on. **No migration** (no schema change, no server change, no new API).
**Branch:** `step-8-3-screen-naming` (stacked on the unmerged Phase 18A, 21 and 22 branches).

## Gating (nothing runs unless all four are true)

1. Feature switch `screenNaming` (Admin > Feature switches; defaults on like every flag, as `tests/flags.test.ts` requires).
2. **Per-device opt-in** "Read names from the call screen (beta)", default OFF (`localStorage` key `minutely.screenNaming`). Shown in the guided call section of Record and under Profile > Preferences, and only where it can work (flag on, laptop Chromium, not the app).
3. A **guided** tab recording ("Record an online call"). The older Audio source selector does not read names.
4. Chromium on a laptop (`guidedCallAvailable`), never the Android app or phones.

When any of these is false: the video track is stopped immediately exactly as before, nothing is imported, no OCR file is requested. The namer and Tesseract.js sit in lazy chunks (`import()` from `startNaming`), loaded only when a naming recording starts.

## What was built

- **Video track kept, not recorded.** `getTabAudio(guided, keepVideo)` keeps the picture track of the share only when naming is on. It is never connected to anything that records; frames are grabbed on demand (`ImageCapture.grabFrame`, else a hidden `<video>`). It is stopped on Stop, cancel, unmount and failed start (`disposeNaming` inside `cleanupMedia`), and "Share again" swaps it together with the audio.
- **"Is it me?"** (`naming/who.ts`). A mic analyser (before the mix) and the existing tab analyser feed a 150 ms loudness history. Per phrase: mic clearly louder and tab near silent = me; tab louder = call. A voice becomes "You" after 2 "me" phrases and a 75% "me" share; one voice only. It is never read from the screen. (The app has no profile display name, only an email, so the label is "You".)
- **Trigger.** A phrase assigned to a voice (on-device diarization, or a Deepgram turn) with the call side dominant, from a voice without a user name or a confirmed name, no newer phrase on another voice, phrase not older than 6 s, not paused, at most one read every 3 s (`naming/gate.ts`).
- **Active tile** (`naming/highlight.ts`, pure, works on ImageData). 640 px wide nearest-neighbour copy of the frame. Platform palette mask (HSV) -> long thin horizontal runs -> a rectangle whose four sides are at least 60% (mean 80%) highlight-coloured = the speaking tile. Unknown platform tries all three palettes. No ring: speaker-view fallback = the biggest rectangular "not page background" blob, accepted only if it is at least 1.8x bigger than the next tile (a gallery of equal tiles gives no answer rather than a guess). The label strip is the tile's bottom-left (84-99% down, 1-61% across), cropped at **full resolution**, scaled to about 72 px tall, greyed, inverted when light-on-dark, contrast stretched (`naming/ocrPrep.ts`).
- **Name cleaning** (`naming/nameClean.ts`). Strips (Host)/(You)/[..], "is presenting", " - Guest" tails, icons and junk; fixes 0/1/5/8 inside words; rejects devices and rooms (iPhone, Galaxy, Conference room, Guest...), UI words (Mute, Camera, You...), under 2 letters, single letters, consonant strings, lower-case starts, more than 4 words. Cut-off labels ("Priyanka Sh...") are only kept if they match someone expected. Fuzzy match (Levenshtein, word-order swap, unique first name, prefix) against **plan attendees** (threshold 0.8) then the **People directory** (0.92); two equally good roster hits give no match.
- **Voting** (`naming/nameVote.ts`). A read counts at OCR confidence >= 55 (>= 40 when it matches someone expected). A name is applied at 2 agreeing reads (and ahead of any other name) or 1 read matching an expected person with no competitor. It shows as "probably {name}" until 3 reads agree, then confirmed. A name or a clear typed by the user locks that voice for good; one name goes to one voice; a confirmed name is not replaced by a later leader; the "You" label is never replaced.
- **Storage.** Names go through the existing `speakerNames` path (`setSpeakerNames` on device, PATCH on the server). Only strings are kept; frames and crops live in memory for one read.
- **UI.** While active: "Reading names on this device" with a pulse during a read, and a chip per screen-read name ("probably" prefix until confirmed). Tapping a chip opens the usual rename sheet. If OCR can't load: a quiet line, recording unaffected. After Stop the chips go and the names are normal speaker names.
- **Naming report.** Per-meeting stats (voices, names set, names you changed afterwards, reads, usable/rejected/no tile/errors, tile found by ring or speaker view) in the device database (`naming:<meetingId>` in the existing kv table, no schema change), remapped onto the final voice numbers after the stop-time re-clustering. Shown on the meeting's Transcript tab only while this device has the beta on, with **Copy report**. Never sent anywhere.
- **Swappable engine.** `NameReader` (`naming/reader.ts`) is the adapter interface. Cactus "Mirage" has no confirmed browser/ONNX build, so it is not used; it can be dropped in later by implementing `NameReader`.

## OCR assets (self-hosted in `public/tesseract/`, gitignored, copied by `scripts/copy-tesseract.mjs` on `npm install`, like `/ort/`)

| File | Size |
|------|------|
| `worker.min.js` | 0.11 MB |
| `tesseract-core-simd-lstm.wasm.js` (SIMD, LSTM only, wasm inlined) | 3.72 MB |
| `lang/eng.traineddata.gz` (`@tesseract.js-data/eng` 4.0.0_best_int) | 2.82 MB |
| **Total, downloaded once, then cached by the browser (`immutable`)** | **about 6.7 MB** |

- Verified with `next start`: all three return 200 from the same origin with `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`. Worker, core and language paths are all explicit, so nothing is requested from a CDN.
- The service worker is unchanged: `/tesseract/*` goes to the network and the browser cache. Only the small lazy JS chunk (about 52 KB) is in the SW precache.
- **tessdata_fast was not on npm**: `@tesseract.js-data/eng` ships 4.0.0 (full, 10.9 MB gz) and 4.0.0_best_int. The integer-quantised "best" data (2.8 MB) was used, similar in size to tessdata_fast. A Node smoke test with these exact files read synthetic tile labels correctly (96% on "Priya Nair", "Rahul Sharma (Host)", "Anita Rao"; "Meera Iyer is presenting" came out "Meera lyer is presenting", an I/l slip that the roster match is there to fix).
- **Hindi was not added.** `hin` is 1.4 MB, which would be fine, but names on Meet/Teams/Zoom tiles are overwhelmingly Latin script and a second language slows every read and adds mistakes. Adding it later is one copy line and `"eng+hin"`.
- New dependencies: `tesseract.js@7.0.0`, `@tesseract.js-data/eng@1.0.0` (package.json and lock file).

## Tests

`npm test`: 620 pass (77 new in `tests/screenNaming.test.ts`): the mic-vs-tab decision and the "me" voice, rate limiting, ring detection for Meet, Teams and Zoom colours on synthetic frames (plus rounded corners, a gap, wrong platform colour, banners, single lines), speaker-view fallback (and refusal for equal tiles), label strip and scaling, name cleaning, fuzzy matching and the two rosters, voting and confirmation thresholds, user-override precedence, one name per voice, report counts and remapping, opt-in storage and the all-conditions gate, OCR preparation. `npx tsc --noEmit`, `npm run build`, `npm run check-build` pass.

## Known limits and accuracy risks (read before turning it on for anyone)

1. **The highlight colours are guesses.** The palettes (Meet blue, Teams purple, Zoom green) were written from memory of each UI, not measured on real calls, and the platforms change their look. If no ring is found the speaker-view fallback or nothing is used. First job of the UAT.
2. **Speaker and spotlight layouts often have no ring**, and the label's bottom-left position, size and background (Teams puts a mic icon beside it) are assumptions. A wrong crop reads junk, which is rejected, so the usual failure is "no name", not a wrong one.
3. **Wrong-person reads:** the highlight can move between the phrase ending and the frame grab (up to a few seconds, because the embedding finishes late). Guards: recent phrases only, no newer phrase on another voice, 2-3 agreeing reads, user override. People talking over each other can still be mis-assigned.
4. **Voice splitting:** live clustering can split one person into two voices (known from Phase 4). The second one can't take a name already used, so it stays "Speaker N" until the stop-time refinement merges them.
5. **Several people on one tile** (a meeting room) show one name for several voices; the first voice to win gets it.
6. **"You" needs headphones**: without them the call leaks into the mic, the tab is no longer "near silent" while you talk, and no "me" label is given.
7. A hidden or minimised call tab gives few or no frames (the browser throttles it). A share with no picture track makes naming idle.
8. Names in non-Latin scripts (Hindi, Arabic) are not read. Device and UI words are rejected by an English word list.
9. Tile finding runs on the main thread on a 640 px frame (a few ms, not measured on a slow laptop); recognition runs in Tesseract's own Web Worker.
10. Mirage and other browser VLMs are not evaluated; the adapter seam is ready.
11. Not exercised in a real browser with a real call (none was available): everything pure is unit-tested, the OCR engine and assets were smoke-tested in Node and served by `next start`, and the browser wiring (ImageCapture, worker spawn under COEP, canvas crops) is covered by type-check and build only. The UAT covers it.

## Files

New: `src/lib/naming/{who,gate,highlight,nameClean,nameVote,stats,ocrPrep,optIn}.ts` (pure), `src/lib/naming/{reader,tesseractReader,frames,screenNamer,client}.ts`, `src/components/{ScreenNamingToggle,NamingStrip,NamingReport}.tsx`, `scripts/copy-tesseract.mjs`, `tests/screenNaming.test.ts`.
Changed: `src/lib/flagsCore.ts`, `src/hooks/useRecorder.ts`, `src/components/{Recorder,GuidedCall,MeetingView,ProfilePage}.tsx`, `next.config.ts`, `package.json`, `package-lock.json`, `.gitignore`.
