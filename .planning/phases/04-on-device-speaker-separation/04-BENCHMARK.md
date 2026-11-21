# Phase 4 Benchmark: on-device speaker embeddings (D-03 spike)

**Measured this run** (2026-11-21, plan 04-01) with `node scripts/diarize-bench.mjs --wasm` (clean) and `node scripts/diarize-bench.mjs --degraded`.
Machine: Windows 11 laptop, Node v24.19.0. Download: about 12 MB (model 6.7 MB q8 + about 5 MB LibriSpeech test-clean FLAC, CC BY 4.0), cache outside the repo (`%TEMP%/transcriber-diarize-bench`).
Data: 40 utterances, 6 speakers. Degraded copy = volume 0.5, echo 40/75 ms, lowpass 5 kHz, pink noise 0.03 (far-field phone imitation). Online scores average 10 shuffled "meeting" orders. Crops are the middle slice of the phrase.

## Speed (laptop, WeSpeaker ResNet34 q8, 1 thread)

| Runtime | Crop | ms / phrase | ms per audio second |
|---------|------|-------------|---------------------|
| Node CPU, 1 thread, q8 | full (2-28 s) | 450 | 62 |
| Node CPU, 1 thread, q8 | 8 s | 341 | 63 |
| Node CPU, 1 thread, q8 | 6 s | 311 | 66 |
| Node CPU, 1 thread, q8 | 3 s | 193 | 66 |
| Node CPU, 1 thread, q8 | 1.5 s | 111 | 74 |
| onnxruntime-web WASM, 1 thread (app runtime) | full | 745 | 126 |
| onnxruntime-web WASM, 1 thread (app runtime) | 8 s | 641 | 123 |
| onnxruntime-web WASM, 1 thread (app runtime) | 6 s | 571 | 122 |
| onnxruntime-web WASM, 1 thread (app runtime) | 3 s | 363 | 125 |
| onnxruntime-web WASM, 1 thread (app runtime) | 1.5 s | 277 | 185 |

WASM timings use the first 16 utterances. Cost is linear in audio length (about 125 ms per audio second on WASM), so cropping is what bounds the blocking time.

## Clustering quality (ARI 1.00 = perfect, 6 true speakers; reference implementation in the script)

| Audio | Crop | Online theta 0.40 / 0.45 / 0.50 / 0.55 (ARI, found) | AHC dist 0.5 / 0.6 / 0.7 / 0.8 (ARI, found) |
|-------|------|------------------------------------------------------|---------------------------------------------|
| clean | full, 8 s, 6 s | all 1.00, 6.0 | 1.00 / 1.00 / 0.97 (5) / 0.73 (4) |
| clean | 3 s | 1.00 (5.9) / 1.00 / 1.00 / 1.00 (6.0) | 1.00 / 1.00 / 0.97 (5) / 0.73 (4) |
| clean | 1.5 s | 1.00 (6.1) / 1.00 (6.1) / 0.98 (6.6) / 0.92 (7.5) | 0.94 (8) / 1.00 (6) / 1.00 (6) / 0.96 (5) |
| degraded | 6 s | 0.93 (4.9) / 0.99 (5.8) / 1.00 (6.1) / 0.98 (6.5) | 1.00 / 1.00 / 0.97 (5) / 0.43 (3) |
| degraded | 3 s | 0.97 (5.1) / 0.97 (5.3) / 0.97 (6.8) / 0.91 (7.8) | 0.90 (9) / 1.00 (6) / 0.97 (5) / 0.73 (4) |
| degraded | 1.5 s | 0.81 / 0.78 / 0.70 / 0.69 (all 8.0, cap) | 0.27 (26) / 0.52 (17) / 0.84 (9) / 0.73 (4) |

## Conclusions

- Crop 6 s on normal devices loses nothing versus the full phrase. 3 s is usable (degraded: 0.97 ARI online, 1.00 at AHC 0.6). Crop **3 s on slow devices** (embed over about 1.5 s).
- Below 1.5 s degraded audio breaks down (26 speakers at AHC 0.5). Skip phrases under 1 s (D-05); treat 1-1.5 s as unreliable.
- **LIVE_THETA 0.45** stays: at 0.55 noisy short crops over-split (7.8 found at 3 s). It is a constant, to be re-tuned from the phone recording.
- **AHC_THRESHOLD 0.70** stays as the default distance. Measured here 0.6 is slightly safer on LibriSpeech (0.7 merged two similar voices on clean audio, ARI 0.97), but 0.7 is more robust against over-splitting on noisy 1.5-3 s crops. The measured difference is small (0.97 vs 1.00); real meetings are harder than LibriSpeech, so kept at the planned 0.70 with the small-cluster cleanup. Revisit after UAT.
- Real meetings (room echo, distance, same-gender colleagues, Indian-English accents) are harder than LibriSpeech; these numbers are starting values.

## Phone estimate (UNMEASURED)

Assumed 3-5x slower than the laptop on a mid-range phone in a single-threaded WebView WASM: roughly 350-600 ms per audio second. A 6 s crop would cost 2-3.6 s, a 3 s crop 1-1.8 s. This is why cropping and skipping are mandatory. The Xiaomi phone benchmark is item 1 of 04-HUMAN-UAT.md (read `embedMs` / `cropSec` from the worker console).

## Production clustering (diarize.ts)

(Filled in by Task 2 of plan 04-01.)
