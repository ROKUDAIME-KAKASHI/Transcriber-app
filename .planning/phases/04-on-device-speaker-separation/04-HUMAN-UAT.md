# Phase 4 Human UAT: On-device Speaker Separation

Run on the Xiaomi phone (APK) and a laptop browser after the next deploy (Claude does not deploy and runs no adb/emulator). Record pass/fail in the table at the end.

1. **Phone speed benchmark (SPK-05).** On the Xiaomi phone via `chrome://inspect`, record a 20+ minute meeting with 2-3 people using a Moonshine engine with speaker separation on. In the speech worker console read the lines `[speaker] embedMs=... cropSec=...`. Note: the mean `embedMs`; whether `cropSec` dropped from 6 to 3 (slow-device switch); whether "Catching up · N phrases waiting" ever grows beyond 2 (the backlog must never keep growing, transcription must not lag versus a recording without speaker separation); how many speakers were found versus the real number. Compare with the laptop numbers in 04-BENCHMARK.md (about 125 ms per audio second on WASM, so a 6 s crop is about 0.6 s on the laptop).
2. **Live labels online (SPK-01).** Laptop browser, Moonshine, two people alternating: chips "Speaker 1/2" appear while recording; "Identifying speakers" shows only while labels are pending.
3. **Offline labels (SPK-01, D-02).** Phone: Download for offline (size about 110 MB, "+ speaker model"), airplane mode, record 2 people: labels appear. With the speaker model deleted from Cache Storage, recording still starts and has no labels.
4. **Refinement saved (SPK-02, trap 3).** Stop on the phone, see "Refining speakers", then open the same meeting on the laptop: same refined labels.
5. **Rename once (SPK-03).** Rename Speaker 2 during recording and on the meeting page: the name shows in all chips, copy text, TXT, Word, PDF. An HTML-ish name like `<b>x</b>` renders as plain text in the PDF.
6. **Rename survives refinement (trap 4).** Rename during recording, stop: the name stays on the same voice.
7. **AI minutes (SPK-04).** Create minutes on a 2-speaker on-device meeting with names: statements, decisions and actions are attributed to the names. A long meeting (above the chunk threshold) keeps labels in every part.
8. **Never falls behind (SPK-05).** 60+ minute phone meeting with Moonshine: "Catching up · N phrases waiting" never stays above 2. Compare against the same phone with Deepgram or no labels if in doubt; note mean embedMs from chrome://inspect.
9. **Deepgram unchanged (D-13).** A Cloud engine meeting still gets cloud labels and never shows "Identifying speakers".
10. **Old APK / website (D-13).** An older APK and a laptop browser load the new web code; old meetings (all speaker 0) look as before.
11. **Threshold tuning note.** If 2-person meetings show 3+ speakers or merge people, record the meeting and retune LIVE_THETA / AHC_THRESHOLD with `node scripts/diarize-bench.mjs --app`.

## Results

| # | Pass/Fail | Notes |
|---|-----------|-------|
| 1 | | mean embedMs: , cropSec: , backlog max: , speakers found/real: |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | mean embedMs: , backlog max: |
| 9 | | |
| 10 | | |
| 11 | | |
