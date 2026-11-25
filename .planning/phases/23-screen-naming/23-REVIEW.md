---
phase: 23-screen-naming
reviewed: 2026-11-25T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/hooks/useRecorder.ts
  - src/lib/naming/screenNamer.ts
  - src/lib/naming/frames.ts
  - src/lib/naming/nameVote.ts
  - src/lib/naming/nameClean.ts
  - src/lib/naming/who.ts
  - src/lib/naming/gate.ts
  - src/lib/naming/optIn.ts
  - src/lib/naming/client.ts
  - src/lib/naming/tesseractReader.ts
  - src/lib/naming/stats.ts
  - src/components/Recorder.tsx
  - src/components/GuidedCall.tsx
  - scripts/copy-tesseract.mjs
  - next.config.ts
  - package.json
  - .gitignore
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 23: Code Review Report

No regression found in the normal, APK or other-tab paths. Gating is sound: `namingOn = guided && screenNamingAllowedNow(true)`, which needs flag, opt-in, guided and laptop Chromium. With it off, `getTabAudio(guided, false)` stops every video track exactly as before, and the namer, OCR and Tesseract are only reached through dynamic imports. The native (APK) path returns before any naming code. The video track is released on stop, cancel, start failure, unmount (the unmount effect calls `stop`, which calls `cleanupMedia`, which calls `disposeNaming`), Share-again and the "problem" path (`disp.getTracks().forEach(stop)`). Tesseract is terminated in `dispose`, and a late `loadReader` result is disposed. The 3 s gate holds (single `busy` flag, `mayRead` is the only entry). Frames are never stored or logged, the reader's logger and errorHandler are no-ops, and only name strings and counters reach `kv`. The issues are below.

## Critical Issues

### CR-01: A name the user typed can be overwritten by an automatic name at stop-time merge
**File:** `src/lib/speech/diarize.ts:283-296` (called from `src/hooks/useRecorder.ts` around line 636, `remapNames(speakerNamesRef.current, live, final)`)
**Issue:** `remapNames` walks the names in ascending voice number, and the first name to reach a final cluster wins (`if (out[target] === undefined)`). The namer has no say in this and `speakerNames` carries no record of origin. Scenario: voice 1 gets "Priya" from the screen, and the user types "Rahul" on voice 3. `refine()` merges 1 and 3. Voice 1's auto name takes the merged voice, and the user's name is silently dropped. The same applies to the "one name per voice" rule, since a merge keeps whichever name is lowest-numbered, not the user's. `nameVote.isUserNamed` protects only the live phase, and the namer is disposed before `refineSpeakers`.
**Fix:** Pass a set of user-set voices (the namer's `locked` set, plus any name not equal to an `auto` entry) into `remapNames`. Give those voices priority, and give auto names priority only when no user name targets the same final voice. Keep `namerRef`'s `locked`/`auto` snapshot before `cleanupMedia()` for this.

## Warnings

### WR-01: "Probable" names are stored, synced and exported as if confirmed
**File:** `src/hooks/useRecorder.ts:2067` (`setAutoName: (cluster, name) => void writeSpeakerName(cluster, name)`), `src/lib/naming/nameVote.ts:151`
**Issue:** `planName` returns `level: "probable"` after 2 reads, or after 1 read matching the roster. The host drops the level and writes the bare name into `speakerNames`. It then syncs, appears in exports and goes into minutes as a fact. The "probably" qualifier exists only in the live strip and the local report. A wrong "probably Priya" becomes "Priya" in the minutes.
**Fix:** Write probable names only to the local UI until they reach confirmed, or store them as `"Priya?"` until confirmed. Alternatively, apply the name in `speakerNames` only at confirmed, and show probable in the strip only.

### WR-02: Roster fuzzy match false-matches on short and first names
**File:** `src/lib/naming/nameClean.ts:97-104,138,172`
**Issue:** (a) The first-name shortcut scores 0.85*sim+0.1, which is 0.95 for an exact first name. That clears `DIRECTORY_THRESHOLD` (0.92), so a participant "Rahul" is labelled with the single directory entry "Rahul Sharma" and marked `roster: true`. That lowers the confidence bar to 40 and lets a single read give a probable name. (b) `similarity()` is edit distance over length, so `Amit` vs `Amita` and `Ravi` vs `Ravina` score 0.8 and 0.67. At the 0.8 attendee threshold, differently gendered or related names pass whenever there is no tie. (c) The truncated-label rule matches `rosterKey.startsWith(cand without trailing 1-2 char word)` with only 4 characters of candidate.
**Fix:** Do not allow first-name-only matches against the directory (attendees only). Require a minimum key length (at least 5 letters) for fuzzy matching, and use exact match below that. Require the first-name shortcut to be the only plausible first name in the roster, not only a non-tie.

### WR-03: Tile text flows into AI prompts unlabelled (prompt-injection surface)
**File:** `src/app/api/meetings/[id]/process/route.ts:122-130`, `src/lib/meetingForAi.ts:40-43`, `src/lib/naming/nameClean.ts:cleanName`
**Issue:** Names reach the prompt through `transcriptToText` / `speakerLabel` as `Name: text` lines, with no marker that they are untrusted. `cleanName` allows up to 4 capitalised alphabetic words (≤40 chars). A participant can set a display name such as "Ignore All Previous Instructions" or "System Output Only", which passes (no digits, vowels present, not in `DEVICE_WORDS`/`UI_WORDS`). It then becomes a speaker label in every minutes/action-item prompt. The server schema only bounds length (60).
**Fix:** In the prompts, state that speaker labels are untrusted data and not instructions. Optionally restrict auto names to roster matches or add an instruction-word deny-list (`ignore|instruction|system|prompt|assistant`). Consider a 1 to 3 word limit.

### WR-04: Stale-frame attribution window is too wide
**File:** `src/lib/naming/screenNamer.ts:24,126-130`, `src/hooks/useRecorder.ts:553-558`
**Issue:** The screen is read when the embedding arrives (`noteSpeech`), not when the phrase ended. The staleness guard allows 6 s (`MAX_STALE_MS`). With a different speaker highlighted at read time, the other person's name is voted for this voice. Two consistent reads (for example, back-and-forth in a two-person call where embeddings lag) can confirm the wrong name. Only the "newest phrase belongs to another voice" check mitigates it, and only when a newer phrase has already been assigned. Also `noteSpeech` is called per Deepgram result message with a fixed `classify(3)`, which inflates `tally` counts (the 2-vote "me" threshold is easy to hit).
**Fix:** Reduce `MAX_STALE_MS` to about 2 s, and read only when the highlighted tile has been stable across two grabs. In the Deepgram path, call `noteSpeech` on `speech_final` or `is_final` only, with the real duration.

### WR-05: "You" is written as a speaker name and goes into minutes, exports and sync
**File:** `src/lib/naming/screenNamer.ts:159-163`, `src/lib/naming/nameVote.ts:162-168`
**Issue:** The user's voice is stored as the literal name "You". Exported transcripts and minutes shared with other people then read "You: ..." (ambiguous to the recipient), and the AI prompt gets "You" as a speaker name. If `meCluster` changes (a different voice later wins the majority), the old voice keeps "You", and `applyMe` for the new one is blocked by `nameTakenElsewhere("You")`, so the namer's `mine` points to an unnamed voice. Also `ME_MIN_VOTES = 2` with a 0.75 share is easy to trip when the mic is picking up the call through speakers (it requires the tab to be quiet, but the tab's own sample can be at 0 if `getTabAnalyser()` returns null, which makes any mic noise "me").
**Fix:** Use the signed-in user's name when it is available, or keep "You" display-only. When `mine` moves, clear the old auto "You" via `host.setAutoName(old, "")` unless it is user-locked. Treat a null tab analyser as "unknown", not 0.

### WR-06: Tesseract assets are not covered by the offline service worker or by check-build
**File:** `public/sw.js` (only `/_next/static/` and `/ort/` are matched), `scripts/check-build.mjs`, `scripts/copy-tesseract.mjs:22-25`
**Issue:** `/tesseract/*` is not in the SW asset list, so the 3.9 MB core and the model load from the network on every first use per device and never work offline (naming then degrades to "unavailable", which is graceful). `copy-tesseract` silently skips with exit 0 when `tesseract.js-core` is not hoisted into `node_modules/` top level (it is a transitive dependency, not declared in `package.json`). A Vercel deploy would then ship without OCR and no check notices it. `.gitignore` is correct (`public/tesseract/` is ignored and not committed, 0 bytes in git), and the postinstall step is Windows and Vercel safe.
**Fix:** Declare `tesseract.js-core` directly in `package.json` (or resolve it through `require.resolve`). Add a `check-build` assertion that `public/tesseract/worker.min.js` and `lang/eng.traineddata.gz` exist. Optionally add them to the SW lazy list.

## Info

### IN-01: `FrameSource.setTrack` clears `disposed`
**File:** `src/lib/naming/frames.ts:49-54`
A `setTrack` after `dispose()` would revive the source. Unreachable today because `namerRef` is nulled on dispose, but it is fragile. Keep a separate `closed` flag.

### IN-02: Embedding backlog makes naming silently inert
**File:** `src/lib/naming/screenNamer.ts:127`
If on-device embedding lags more than 6 s behind the phrase end (slow laptop, single-threaded ONNX), every phrase is rejected as stale and the report shows few reads with no explanation. Count it in the stats (for example `stale`).

### IN-03: Swallowed errors hide failure reasons
**File:** `src/lib/naming/tesseractReader.ts:16-18`, `src/lib/naming/screenNamer.ts:179-181`
`errorHandler: () => {}` and the empty catch are good for privacy (no frame text leaks), but keep a non-identifying error code in the stats for diagnosing "unavailable" status.

---

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Fixes

All findings fixed in commits c6f179d, f553b4d, 917a1f3 (`npx tsc --noEmit`, `npm test` 625 pass, `npm run build`, `npm run check-build` pass). No schema, API or flag change.

- **CR-01:** `remapNames(names, live, final, weak?)` takes the voices whose stored name came from the screen (`ScreenNamer.autoVoices()`, snapshotted before `cleanupMedia`; user-renamed and locked voices are excluded). Typed names are processed first, so they win a merge. Test added.
- **WR-01:** only a confirmed screen name is written to `speakerNames` (and so synced, exported, sent to the AI). "Probably X" is shown only: the hook keeps a local `shownOnly` map, derived from the namer state, merged under the stored names for display. A shown-only name still blocks the same name on another voice (`nameTakenElsewhere` checks the auto map). Probable names are dropped at Stop, by design.
- **WR-02:** first-name-only matches need a unique first name in the roster and never apply to the People directory; names under 5 letters must match exactly (Amit vs Amita, Ravi vs Ravina); a cut-off label needs a stem of at least 5 letters. Tests added.
- **WR-03:** `aiSpeakerLabel` (one line, no markup, instruction words removed, 30 characters) is used for every AI transcript (process, generate, extract, ask, labelled lines); exports are unchanged. Prompts get `UNTRUSTED_LABELS_NOTE` (the standalone action-items template text is untouched because a test pins it; the note goes in the system message). `cleanName` now allows 3 words and 30 characters and rejects instruction words.
- **WR-04:** `classify()` (phrase end) grabs a frame when the phrase is call-side and the gate allows it, and holds that one frame for the phrase; the read uses it however late the voice arrives (up to 8 s). Without a held frame, a read is skipped when the phrase is older than 1.5 s (was 6 s) and counted in `stale`. Deepgram calls `noteSpeech` once per utterance (speech_final or UtteranceEnd) with the summed word duration.
- **WR-05:** "You" is no longer stored; it is shown from the current `meCluster`, and when that moves the old label goes with it. A missing mic or tab analyser records no sample, so the phrase is "unknown" rather than silence. Not unit-tested (the namer class needs browser APIs); covered by type-check and build.
- **WR-06:** `copy-tesseract.mjs` resolves `tesseract.js`, `tesseract.js-core` (from tesseract.js) and `@tesseract.js-data/eng` with `require.resolve` and exits 1 with a clear message when one is missing; it runs in `postinstall`, which Vercel runs on install. `check-build` asserts the three files exist. The service worker does not cache `/tesseract/` (it is 6.7 MB, not part of the precache manifest): naming needs those files to have loaded once on the device, and says "unavailable" otherwise. Documented, not changed.
- **IN-01:** `FrameSource` has a `closed` flag; `setTrack` after `dispose` does nothing.
- **IN-02:** `stale` count in the stats and the report.
- **IN-03:** `errCodes` (fixed codes such as `no-frame`, `ocr-load`, never messages) in the stats and the report.
