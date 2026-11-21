# Phase 4 Human UAT: On-device Speaker Separation

Run on the Xiaomi phone (APK) and a laptop browser after the next deploy (Claude does not deploy and runs no adb/emulator). Record pass/fail in the table at the end. Plan 08 appends the remaining items.

1. **Phone speed benchmark (SPK-05).** On the Xiaomi phone via `chrome://inspect`, record a 20+ minute meeting with 2-3 people using a Moonshine engine with speaker separation on. In the speech worker console read the lines `[speaker] embedMs=... cropSec=...`. Note: the mean `embedMs`; whether `cropSec` dropped from 6 to 3 (slow-device switch); whether "Catching up · N phrases waiting" ever grows beyond 2 (the backlog must never keep growing, transcription must not lag versus a recording without speaker separation); how many speakers were found versus the real number. Compare with the laptop numbers in 04-BENCHMARK.md (about 125 ms per audio second on WASM, so a 6 s crop is about 0.6 s on the laptop).

## Results

| # | Pass/Fail | Notes |
|---|-----------|-------|
| 1 | | mean embedMs: , cropSec: , backlog max: , speakers found/real: |
