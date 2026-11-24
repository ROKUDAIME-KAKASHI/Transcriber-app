# Phase 8: Offline Recording With Screen Locked - Research

**Researched:** 2026-11-24
**Domain:** Android foreground-service audio capture (Capacitor 8 plugin, Java) feeding the existing in-WebView on-device speech pipeline (VoiceChunker, speech worker, diarization, Dexie)
**Confidence:** MEDIUM-HIGH. The code facts are HIGH (read from source). Android platform rules are HIGH (official docs). How the hidden WebView's JS behaves while the FGS holds a wake lock is LOW and needs a device test, but the recommended design works either way.

## Summary

Today an on-device (Moonshine/Whisper) recording in the APK runs entirely in the WebView: `getUserMedia` → `VoiceChunker` (AudioWorklet) → speech worker. `Recorder.tsx` only routes to the native service when the engine is `deepgram` (`nativeMode = inApp && (effective === "deepgram" || nativeRec.isRecording || nativeRec.isStarting)`). So during an on-device recording **no foreground service runs and no partial wake lock is held**. `navigator.wakeLock("screen")` only works while the page is visible. When the phone locks, the app becomes a background process. Android 9+ blocks background apps from the microphone ("Your app cannot access the microphone or camera"; the fix is a foreground service), and nothing keeps the CPU awake. The audio during the lock is silent or missing, which is the "10-minute hole" in PITFALLS.md. Capacitor itself does **not** pause the WebView: `Bridge.onPause` → `MockCordovaWebViewImpl.handlePause(keepRunning)` only calls `webView.onPause()/pauseTimers()` when `KeepRunning` is false, and the default is `true`. The cause is the OS, not Capacitor.

**Recommended architecture (hybrid: native capture is the source of truth, the page is the transcriber).** Add a `mode: "local"` to the existing `RecordingService`. In local mode it records 16 kHz mono s16le PCM with the same `captureLoop` into append-only segment files under `getNoBackupFilesDir()/offline-rec/<meetingId>/`. It uses no network, no OkHttp, no WebSocket, no autosave and no Wi-Fi lock. The page pulls audio through new plugin methods (`readAudio` returns base64), feeds it frame by frame into a **feed-mode `VoiceChunker`** (no AudioWorklet, same VAD), and the rest of `useRecorder`'s on-device path is reused unchanged: `transcribeFinal` with embeddings, `appendFinal`, `applyVector`, `refineSpeakers`, `putParts`, sync. A **committed sample cursor** is stored in the Dexie meeting row in the same transaction as the parts, so a reload, renderer kill or app kill resumes exactly where it stopped, with no gaps or duplicates. Whole segment files are deleted once the cursor passes them, and the whole folder is deleted after the meeting is DONE. If the hidden WebView keeps running (likely, since the FGS keeps the process foreground and wakes the CPU, and Capacitor doesn't pause timers), transcription stays live with the screen off. If it doesn't, the backlog is caught up when the screen comes back ("Catching up · 12 min of audio left").

Alternatives were rejected. (B) "Start the FGS and keep `getUserMedia`" is the smallest change, but the audio would live only in the renderer's memory. One renderer OOM kill, which is likely on MIUI with ONNX in the renderer, loses everything, and its behaviour can't be verified without the device. (C) Native ONNX/sherpa-onnx in the service would be a second ASR stack: JNI libraries, separate model downloads (the transformers.js models sit in the WebView's Cache Storage, which Java can't reach), and VAD, cleanup and diarization reimplemented in Java. That is several phases of work.

**Primary recommendation:** Native `RecordingService` local mode writes PCM segment files. The page pulls them through `MeetingRecorder.readAudio`, feeds them into a feed-mode `VoiceChunker` inside `useRecorder`, and stores a committed sample cursor atomically with the parts in Dexie. Gate all of it behind a new `MeetingRecorder.capabilities()` so old APKs and the website keep today's behaviour.

## User Constraints

No `08-CONTEXT.md` exists (the phase folder was empty at research time), so there are no locked decisions from discuss-phase. Binding constraints come from ROADMAP.md and CLAUDE.md:

**Phase 8 success criteria (ROADMAP.md, verbatim):**
1. In the APK, starting an on-device recording runs the native foreground service capture; audio keeps being captured with the screen locked for a long meeting (1h+), with no internet
2. Captured audio is transcribed on the device (with speaker labels) — live when the WebView is running, and any backlog is caught up when the screen comes back on — with no gaps or duplicates
3. Stopping from the notification, the app, or the Meetings panel finalizes the meeting; the backlog audio is deleted from the phone once transcribed; old APKs and the website keep working as before

**Requirement OFF-V2-01 (REQUIREMENTS.md):** "On-device (offline) recording continues with the phone locked in the Android app (native capture into a file, transcribed by the page / native ONNX)". This research picks "transcribed by the page".

## Project Constraints (from CLAUDE.md)

- Keep Next.js 16 App Router + Tailwind v4 + Capacitor 8. No rewrite.
- Never print `.env` or keystore secrets. Keys stay server-side. (Local mode needs no keys at all.)
- No Vercel deploys and no public tunnels by Claude. Device UAT is done by the user. Claude runs no adb or emulator (see 04-HUMAN-UAT.md).
- C: drive nearly full: avoid big downloads and emulators. This phase needs no new packages or models.
- Models: research on Opus, implementation on Sonnet, small tasks on Haiku.
- **Compatibility: it must keep working as a plain website and inside old installed APKs.** New native methods need feature detection (Pitfall 3 in PITFALLS.md).
- GSD workflow: edits only through GSD commands.
- Ground truth: `server.url` mode injects the bridge into every same-origin document (`Bridge.java` L262-272). The SW (`public/sw.js`) passes through everything except `/_next/static/`, `/ort/` and navigations.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OFF-V2-01 | On-device (offline) recording continues with the phone locked in the Android app | Q1 root cause (no FGS / background mic restriction); native local capture (§Architecture, Pattern 1); feed-mode chunker reuse (Pattern 2); committed cursor and recovery (Pattern 3); catch-up pacing and embedding fix (Pitfalls 2-3); stop flows (Pattern 4); capability gating (Pattern 5) |
</phase_requirements>

## Answers to the Research Questions

### Q1. What stops today when the screen locks during an on-device recording in the APK?

| Layer | What happens | Evidence | Confidence |
|-------|--------------|----------|------------|
| Which recorder runs | `useRecorder` (web path: `getUserMedia` → AudioWorklet `VoiceChunker` → worker). The native service is **not** started for Moonshine/Whisper | `Recorder.tsx` L123-129: `nativeMode` is true only for `effective === "deepgram"` or an already-running native session | HIGH (code) |
| Wake locks | Only `navigator.wakeLock.request("screen")` (`useRecorder.acquireWakeLock`). Screen wake locks are released when the page is hidden. No `PARTIAL_WAKE_LOCK` | `useRecorder.ts` ~L555-570; `RecordingService.acquireLocks` is only reached in cloud mode | HIGH (code), MEDIUM (spec release-on-hidden) |
| Process state | No visible activity and no FGS, so the app is a background process | Android process model | HIGH |
| Microphone | Android 9+: "If your app is running in the background … Your app cannot access the microphone or camera … use a foreground service". The WebView's capture (Chromium audio runs in the app process) then delivers silence or stops | developer.android.com/about/versions/pie/android-9.0-changes-all | HIGH (rule), MEDIUM (exact WebView symptom: muted track vs zero frames. The `NO_FRAMES_MS` watchdog in `useRecorder.tick` handles both) |
| CPU | No partial wake lock, so the CPU suspends when the device idles. Main thread, AudioWorklet and the worker all stop until unlock | Android power model | HIGH |
| Capacitor | `BridgeActivity.onPause` → `Bridge.onPause` → `cordovaWebView.handlePause(keepRunning)`. `keepRunning = shouldKeepRunning()` = `preferences.getBoolean("KeepRunning", true)`. `setPaused(true)` (`webView.onPause()` + `pauseTimers()`) runs **only if keepRunning is false**. Capacitor does **not** pause JS | `node_modules/@capacitor/android/.../Bridge.java` L1370-1379, L463-465; `cordova/MockCordovaWebViewImpl.java` L124-136, L278-285 | HIGH (source, 8.6.2) |
| Chromium hidden-page throttling | The page gets `visibilityState=hidden`. Main-thread timers are throttled (≥1 s, then intensive throttling). Chrome's "freeze background pages after 1 min" (M139) "is targeting only non-webview … Android, so webview should be unaffected" | blink-dev PSA "Faster background freezing on Android" | MEDIUM for "WebView isn't frozen"; LOW for exact throttling inside WebView |

**What changes with a running microphone FGS plus a partial wake lock (the proposed design):** the process counts as foreground-service, so the mic restriction no longer applies and the CPU stays awake. Capacitor doesn't pause timers and WebView isn't in Chrome's freezing experiment. The page's JS therefore **probably keeps running hidden**, with throttled timers but unthrottled message and promise delivery. This is **LOW confidence until it is tested on the Xiaomi phone**. The design doesn't depend on it: if JS stops, the audio is safe on disk and gets caught up.

**A risk that applies today too (HIGH, official docs):** `WebViewClient.onRenderProcessGone` must return `true` or "application will crash if render process crashed, or be killed if render process was killed by the system". Capacitor's `BridgeWebViewClient.onRenderProcessGone` returns `false` unless a `WebViewListener` returns true. The `RecordingService` runs in the same app process, so **a renderer OOM kill while the screen is locked takes the recording down with it.** With ONNX models loaded in the renderer, local mode makes this more likely. Fix it in `MainActivity` (Pattern 6).

### Q2. Architecture choice

| Option | What it is | Pros | Cons | Verdict |
|--------|-----------|------|------|---------|
| **A. Native capture to files + page transcribes (chosen)** | `RecordingService` local mode writes PCM segments. The page pulls them, feeds the existing VAD and worker, and stores a cursor | Audio is durable on disk (survives renderer and process kills, reboots). Reuses 100% of the ASR, diarization, Dexie and sync code. Live when JS runs, catch-up otherwise. No new packages or models | Catch-up can take a long time on a slow phone (see Pitfall 4). Needs a cursor protocol | **Use** |
| B. FGS + wake lock, keep `getUserMedia` in the WebView | Start the service only for its FGS and wake lock, and record in the page as today | Smallest diff, truly live | Audio exists only in renderer memory, so any renderer kill or freeze loses it. Unverifiable without the device (Chromium hidden-capture behaviour). Two mic clients if combined with native capture | Reject. Its benefit (live with the screen off) comes free with A when JS keeps running |
| C. Native ASR in the service (sherpa-onnx / ORT Android) | VAD + Moonshine/Whisper + embeddings in Java/JNI | Truly live with the screen off, independent of the WebView | +10-40 MB of native libraries in the APK. A second model download and storage (Java can't read the WebView Cache Storage that holds the transformers.js models). Reimplementing `cleanPhrase`/`hasLoop`, VoiceChunker tuning, diarization clustering (`diarize.ts`) and model downgrade logic in Java. A second runtime to keep in step | Defer. Possible future phase if catch-up time turns out unacceptable |

### Q3. Reusing the pipeline: where to inject, timing, diarization, stop, recovery, storage

- **Injection point: `VoiceChunker.onFrame` (feed mode).** It already takes raw frames, runs `Resampler.process` (for `inputRate = 16000` the ratio is ≤ 1, so it only applies the 80 Hz high-pass, which is still wanted), then does VAD, `peek()` and `emit()`. Add a constructor variant that takes `{ sampleRate: 16000, startAt?: number }` instead of an `AudioContext`, and a public `feed(samples: Float32Array)` that calls `onFrame`. Feed in **640-sample frames (40 ms)**, close to the web path's 2048 samples at 48 kHz (~42.7 ms), so `frameMs`-based timings (`PREROLL_MS`, `NOISE_WINDOW_MS`, silence counting) behave the same. Inject here, not in the worker. Phrase cutting, normalisation, previews and `onSegment` stay identical. (HIGH: `voiceChunker.ts`, `resampler.ts`.)
- **Sample rate:** native already records 16 kHz mono s16le (`RecordingService.SAMPLE_RATE = 16000`, `captureLoop` writes little-endian). Convert in JS with `Int16Array` → `Float32 / 32768`. Keep `MediaRecorder.AudioSource.MIC`, which is proven on the Xiaomi phone. `VOICE_RECOGNITION` is optional and only worth a UAT A/B test. (HIGH.)
- **Timestamps:** VoiceChunker's clock `heard` counts 16 kHz samples, pauses excluded. Native `recordedSamples` also excludes pauses (it skips `backlog.add` while paused). Use the **absolute native sample index** as the chunker clock: `startAt = cursor` on (re)start. `onSegment`'s `startSec = firstVoiced.at / 16000` is then the meeting time, the same as `t` in the web and cloud paths. `durationSec` / `recordingSeconds` come from native `getState().seconds`. (HIGH.)
- **Pause boundaries:** native doesn't write while paused, so the files are continuous. A pause in the middle of a phrase would otherwise stitch audio from before and after the pause together. Native records `breaks` (sample indexes where a pause began) in `meta.json`, and `readAudio` returns the breaks inside the requested range. JS calls `chunker.flush()` and clears the preroll at each break, the same as `pause()`/`resume()` do today. (MEDIUM, design.)
- **Diarization:** unchanged. `onSegment` → `transcribeFinal(audio, { embed })` → `handleEmbedding` / `applyVector` / `refineSpeakers`. One worker change is needed for catch-up (Pitfall 3).
- **Live vs catch-up:** live means `head - readPos < ~3 s`. Read 2 s per pull, previews on. Catch-up means more is behind. Read up to 10 s per pull, **previews off** (`previewIntervalRef = null` while catching up), and pace by the worker (Pattern 2).
- **Stop flows:** see Pattern 4. The notification Stop finalises locally with no network. The service ends capture and marks `meta.json` stopped. The page finishes transcription whenever it runs.
- **Crash/kill recovery:** see Pattern 3. The `offline-rec/<id>/` files plus the Dexie cursor are enough to resume after any kill. `listCaptures()` on Record mount finds them.
- **Storage:** 16 kHz × 2 B = 32,000 B/s = **115.2 MB per hour** (1.15 GB for 10 h). Keep raw PCM. Opus via MediaCodec would need WebCodecs decoding in JS, and segments are deleted as they are consumed, so the backlog is usually small. Check `getNoBackupFilesDir().getUsableSpace()` at start (refuse below ~150 MB with a message) and every 30 s while recording (warn below 1 h of audio, stop capture cleanly below 50 MB and mark `meta.json` `stoppedReason: "storage"`). (HIGH arithmetic, MEDIUM thresholds.)

### Q4. Plugin API, Java, manifest, feature detection, battery

See Patterns 1, 5 and 6, and "Battery / CPU" below. The manifest **needs no change**: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `RECORD_AUDIO`, `WAKE_LOCK` and `POST_NOTIFICATIONS` are already declared, and the service already has `foregroundServiceType="microphone"` and `stopWithTask="false"` (HIGH: `AndroidManifest.xml`). Android 14+ requires the microphone FGS to be created while the activity is visible. That is already true, since the start comes from a tap on the Record screen (HIGH: developer.android.com FGS while-in-use restrictions).

### Q5. Files and plan split

See "Files to Touch" and "Recommended Plan Split" at the end.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mic capture with the screen locked, durable audio | Android native (`RecordingService`, FGS + partial wake lock) | — | Only an FGS gets the mic in the background, and only disk survives process kills |
| Audio segment storage, deletion, free-space checks | Android native (`LocalCapture` in `noBackupFilesDir`) | Page (decides what to release) | Files live where they're written. The page owns the "transcribed up to" knowledge |
| VAD / phrase cutting | Page (`VoiceChunker` feed mode) | — | Reuse the tuned TS implementation |
| ASR + speaker embeddings | Page Web Worker (`speech.worker.ts`) | — | Existing transformers.js + ORT WASM, models already cached offline |
| Transcript, cursor, embeddings persistence | Browser storage (Dexie / IndexedDB) | — | Device-first store from Phase 2. The cursor must be atomic with the parts |
| Server sync, remote stop detection | Page (`sync.ts` engine) | Server (`PATCH /api/meetings/:id` `stopped`) | Unchanged. Only works when online and JS is running |
| Notification Stop/Pause | Android native | Page (finalises later) | Must work with the page dead |

## Standard Stack

No new libraries. Everything uses what is already installed and verified in the repo:

| Component | Version | Purpose |
|-----------|---------|---------|
| `@capacitor/core` / `@capacitor/android` | 8.6.2 (verified `node_modules/@capacitor/android/package.json`) | Plugin bridge (`registerPlugin`, `isPluginAvailable`, `CapacitorException` code `UNIMPLEMENTED` for missing methods) |
| `android.media.AudioRecord` | platform | Existing `captureLoop` (16 kHz, mono, PCM16, `AudioSource.MIC`) |
| `@huggingface/transformers` | 4.3.2 (existing) | Unchanged ASR + WeSpeaker embeddings |
| `dexie` | 4.x (existing) | New non-indexed fields on `meetings` rows, so **no schema version bump is needed** (Dexie only declares indexed keys) |
| `node:test` | Node 24.19.0 | Existing `npm test` → `node --test "tests/*.test.ts"` |

**Installation:** none.

## Package Legitimacy Audit

This phase installs no external packages (npm, Gradle or pip), so slopcheck was not run. **Packages removed:** none. **Packages flagged:** none.

## Architecture Patterns

### System Architecture Diagram

```
 [Tap Record (on-device engine) in APK]
        │  capabilities().localCapture === true ?
        ├── no (old APK / website) ──► today's useRecorder getUserMedia path (unchanged)
        ▼ yes
 useRecorder.start(source "native")
   createLocal(Dexie, nativeCapture=1, nativeCursor=0) ─► MeetingRecorder.start({mode:"local", meetingId, engine, language})
        │                                                          │
        │                                      RecordingService (FGS microphone + PARTIAL_WAKE_LOCK, no network)
        │                                         captureLoop ─► LocalCapture.append(pcm) ─► noBackupFilesDir/offline-rec/<id>/seg-NNNNNN.pcm
        │                                         publishes headSamples (flushed), level, noSound, paused, breaks ─► meta.json
        ▼
 Pump loop (page, runs whenever JS runs; screen on → live, screen off → maybe live / maybe frozen)
   readAudio({from: readPos, maxSamples}) ──base64──► Int16 → Float32 ─► 640-sample frames ─► VoiceChunker.feed()
        │                                                                                         │ onSegment(audio, phraseId, startSec = absSample/16000)
        │                                                                                         ▼
        │                                                          speech.worker: final ASR → (embedding, batch-priority when catching up)
        │                                                                                         ▼
        │                                                 appendFinal → applyVector → save(): putParts(parts, nativeCursor = committed) [one Dexie txn]
        │                                                                                         ▼
        └── after the cursor is saved: releaseAudio({before: committed}) ─► native deletes whole segments below it
 Stop (app button / notification / remote-stop event)
   native: capture off, flush, meta.state="stopped" ─► page drains readPos→head, chunker.flush, await finals,
   refineSpeakers, putParts(DONE) → sync flush ─► discardCapture(meetingId) (folder deleted)
 App reopened after a kill: listCaptures() ─► for each folder: load Dexie parts+cursor+embeddings ─► resume pump from cursor
```

### Recommended file layout (new and changed)

```
android/app/src/main/java/in/transcriber/app/
├── MainActivity.java                 # + WebViewListener.onRenderProcessGone → true + recreate()
└── recorder/
    ├── LocalCapture.java             # NEW: segment writer/reader, meta.json, breaks, free space, list/discard
    ├── RecordingService.java         # + EXTRA_MODE "cloud"|"local"; local skips http/ws/sender/autosave/wifi lock
    └── MeetingRecorderPlugin.java    # + capabilities, readAudio, releaseAudio, listCaptures, discardCapture; start passes mode
src/lib/nativeRecorder.ts             # + types, nativeCapabilities() (cached, never throws)
src/lib/speech/nativeFeed.ts          # NEW pure helpers: b64→Float32, framing, committed-cursor math, ETA text
src/lib/speech/voiceChunker.ts        # + feed mode (no AudioContext), startAt, breakAt
src/lib/speech/embedSchedule.ts       # + batch flag in embedDecision (ignore slow/backlog when paced)
src/workers/speech.worker.ts          # + transcribe msg `batch` → embedDecision(batch)
src/lib/speech/client.ts              # transcribeFinal(audio, { embed, batch })
src/lib/local/types.ts / repo.ts      # LocalMeeting.nativeCapture?, nativeCursor?; putParts(extra); recoverOrphans skip
src/hooks/useRecorder.ts              # source "native": start/pump/stop/detach/resume
src/hooks/useNativeRecorder.ts        # ignore native states with mode === "local"
src/components/Recorder.tsx           # pick native-local for on-device engines when capable; catch-up status copy
tests/nativeFeed.test.ts, tests/embedSchedule.test.ts (extend), tests/voiceChunkerFeed.test.ts
```

### Pattern 1: `LocalCapture` + `RecordingService` local mode (Java)

**What:** a writer owned by the capture thread and a reader used by plugin calls (Capacitor runs plugin methods on a background handler thread, not on the UI thread).

- Folder: `new File(getNoBackupFilesDir(), "offline-rec/" + meetingId)`. Use `noBackupFilesDir`, not `cacheDir` (the OS can clear the cache when storage is low) and not `filesDir` (`android:allowBackup="true"` would offer raw meeting audio to Auto Backup). (HIGH: platform semantics.)
- Segments: `seg-<startSample zero-padded>.pcm`, fixed **5 min = 4,800,000 samples = 9.6 MB** each (`SEGMENT_SAMPLES = 16000 * 300`). Deletion granularity is 5 min.
- `meta.json`: `{ v:1, meetingId, engine, language, startedAt, state: "recording"|"stopped"|"interrupted", stoppedReason?, breaks: [samples…], committed: n }`. Rewrite it atomically (write `meta.json.tmp`, then `renameTo`) on start, pause, stop and every 30 s.
- Writer: `BufferedOutputStream` per segment. `flush()` about once per second, `getFD().sync()` about every 5 s. Publish `volatile long headSamples` **only after flush**, so `readAudio` never reads past flushed bytes. After a crash, recovery computes head as the sum of segment lengths with odd bytes trimmed.
- `RecordingService`: add `EXTRA_MODE`. In `begin()`, if local: skip `http`, `wsClient`, `AudioBacklog`, `registerNetworkCallback`, the `senderThread`, `connect()` and the autosave `save(null)` task, and skip the `WifiLock` (battery). Keep the `PARTIAL_WAKE_LOCK`, `startForeground(... FOREGROUND_SERVICE_TYPE_MICROPHONE)` and `captureLoop`. In `captureLoop`, replace `backlog.add(bytes)` with `sink.accept(bytes)`, where the sink is the backlog (cloud) or `LocalCapture` (local). `beginStop` in local mode: `capturing = false`, join the capture thread, `localCapture.finish("stopped")`, then a `completeStop` variant with no `save("DONE")`. Statuses: "Recording on this phone (works offline)…" and, while behind, "N min of audio waiting to be transcribed — open the app". Behind = `headSamples - committed`, where `committed` arrives through `releaseAudio`.
- After a local stop, the FGS notification goes away. Post an ordinary notification ("Meeting stopped. Open Transcriber to finish the transcript.") with the `MainActivity` content intent if `head - committed > 0`.
- `onDestroy` while running in local mode: `localCapture.finish("interrupted")`, best effort.

**Plugin methods (`MeetingRecorderPlugin`):**

| Method | Args → Result | Notes |
|--------|---------------|-------|
| `capabilities()` | → `{ version: 2, localCapture: true, segmentSamples, sampleRate: 16000 }` | Old APKs reject with `UNIMPLEMENTED`, which means v1 |
| `start` | + `mode: "local"`, `engine` | Local mode doesn't require `baseUrl`. **Old APKs ignore `mode` and would start Deepgram**, so JS must check `capabilities()` first (Pitfall 1) |
| `getState` | + `mode`, `headSamples`, `committed`, `freeBytes`, `stoppedReason` | Same polling as today |
| `readAudio({ meetingId, from, maxSamples })` | → `{ from, samples, data /*base64 s16le*/, head, ended, breaks: number[] }` | Reads one segment at most per call (JS loops). `ended` = stopped/interrupted and `from + samples >= head`. Works when the service isn't running (recovery) |
| `releaseAudio({ meetingId, before })` | → `{ freedBytes }` | Deletes segments whose end ≤ `before`, stores `committed` in meta |
| `listCaptures()` | → `[{ meetingId, head, state, startedAt, engine, language, active }]` | For recovery on app start |
| `discardCapture({ meetingId })` | → `{}` | Refuses while that meeting is actively capturing |

Use `android.util.Base64.encodeToString(bytes, Base64.NO_WRAP)`. 10 s = 320 KB raw ≈ 427 KB base64 per call, well within what the bridge carries (an assumption, A3).

### Pattern 2: Feed-mode chunker + pump loop (TypeScript, inside `useRecorder`)

**What:** replace `getUserMedia` + `chunker.start(stream)` with a pump. Keep everything after `onSegment` unchanged.

```typescript
// Sketch only. Names follow useRecorder.ts. Source of the decode: standard Web APIs.
const FRAME = 640; // 40 ms at 16 kHz
function pcm16Base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer, 0, u8.length >> 1); // little-endian on Android/x86
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}
async function pump(id: string) {
  while (pumpingRef.current) {
    const behind = headRef.current - readPosRef.current;
    const catchingUp = behind > 3 * 16000;
    // Pace by the worker: never queue more than one final (and its embedding) when behind.
    if (catchingUp && (pendingSegmentsRef.current.size > 0 || pendingEmbeds() > 0)) {
      await Promise.race([...pendingSegmentsRef.current, waitEmbedDrainOr(500)]); continue;
    }
    const r = await MeetingRecorder.readAudio({ meetingId: id, from: readPosRef.current, maxSamples: (catchingUp ? 10 : 2) * 16000 });
    headRef.current = r.head;
    if (r.samples === 0) { if (r.ended) break; await sleep(400); continue; } // a throttled timer while hidden is fine
    const f = pcm16Base64ToFloat32(r.data);
    for (let o = 0; o < f.length; o += FRAME) {
      const abs = r.from + o;
      if (r.breaks.some((b) => b > abs - FRAME && b <= abs)) chunkerRef.current!.breakAt(abs);
      chunkerRef.current!.feed(f.subarray(o, Math.min(o + FRAME, f.length)));
    }
    readPosRef.current = r.from + r.samples;
    patch({ catchUpSec: Math.max(0, (r.head - readPosRef.current) / 16000) });
  }
  chunkerRef.current?.flush();
}
```

- **Do not drive catch-up with timers.** Await the worker promises and the Capacitor call results, which are delivered as tasks and messages. Intensive timer throttling in a hidden page (chained `setTimeout` aligned to about one minute) then doesn't slow it down (MEDIUM).
- Level meter / `noSound`: read them from `getState()` (native already computes `level` and `noSound`) in the existing 500 ms tick, not from feed frames. The feed runs faster than real time during catch-up.
- `onLevel` from the chunker must be ignored in native mode, or it would flicker the meter during catch-up.

### Pattern 3: Committed cursor (no gaps, no duplicates)

- **Definition:** `committed = min(chunker.openStart(), oldestInFlightStart, readPos)`.
  - `chunker.openStart()` is the absolute sample of the first preroll/segment frame of the phrase being spoken. If not in speech, it is the first preroll frame, or `heard` when the preroll is empty. Add this getter to `VoiceChunker`, since frames already carry `at`.
  - `oldestInFlightStart` is the smallest start sample (first frame `at`) of phrases sent to the worker whose text hasn't been appended yet. Track it in a `Map<jobId, startSample>` next to `pendingSegmentsRef`.
- Everything before `committed` has either been appended to `partsRef` or was silence or too short.
- **Persist atomically:** extend `putParts(userId, id, parts, durationSec, status?, relabel?, extra?: { nativeCursor?: number })` to write `nativeCursor` in the same Dexie transaction as the parts. Compute `committed` synchronously right before the `putParts` call inside `saveLocal`.
- Only **after** `putParts` resolves true, call `releaseAudio({ before: committed })`.
- **Resume** (remount, reload, renderer kill, app kill): `getParts` → `partsRef`. `getEmbeddings` → `vectorsRef`, then re-run `assignOnline` over the saved vectors in part order to rebuild the `OnlineState` centroids. `getMeta().nativeCursor` → `readPos = cursor`. Create the chunker with `startAt = cursor`. Phrases saved before the cursor are never re-fed, and the phrase in progress is re-fed from its preroll start.
- Edge: embeddings are flushed every 10 (`flushEmbedBuffer`), so after a kill a few saved parts may lack vectors. They follow the previous speaker (existing `applyVector` rule) and are re-clustered at stop. This is acceptable.
- **`recoverOrphans` must skip `nativeCapture === 1` rows** (`repo.ts` L442-470). Otherwise a reopened app marks the meeting DONE because `lastWriteAt` is old (JS was frozen), before the pump re-attaches. Clear `nativeCapture` only after `discardCapture` succeeds.

### Pattern 4: Stop flows

| Trigger | Native | Page |
|---------|--------|------|
| In-app Stop (`useRecorder.stop`, native source) | `MeetingRecorder.stop()` → capture off, `meta.state="stopped"`, final head | Poll `getState` until `!active`, status "Finishing transcription… N min of audio left". Pump drains to `ended` → `chunker.flush()` → `await pendingSegments` → `save()` → `refineSpeakers()` → `save("DONE")` (existing tail of `stop()`) → `discardCapture` → `putParts`/meta `nativeCapture=0` |
| Notification Stop | Same as above (`ACTION_STOP`). No network needed. In local mode "Finish now" isn't needed (nothing waits for the internet) | If JS is running: `getState().finished && mode==="local"` → run the same finalize. If JS is dead: done on the next open through `listCaptures()` (state `stopped`) |
| Meetings panel on **another** device | Not seen natively in local mode (no server calls) | The sync engine's tail PATCH reply `stopped` → `emitRemoteStop(id)` (only if `markRecording(id,true)` was called) → existing `handleRemoteStop` → `stop()`. Works only once the phone is online **and** JS runs. Audio captured after the remote stop is still transcribed. Document this |
| Meetings panel on **this** device | — | `canStopFromList` hides Stop when `activeHere` (`recordingState.ts` L36-47). Keep `markRecording(id, true)` for the whole native-local session, including resume |
| Renderer/app killed mid-meeting | Service keeps capturing (renderer kill, if Pattern 6 is in place) or dies (process kill → `onDestroy` marks `interrupted`, files kept) | Next open: `listCaptures()` → resume (Pattern 3). If `active` it is live again. If `interrupted`, finalize, with the status "Recording was stopped by Android at 42:10. Transcribing what was recorded…" |

### Pattern 5: Feature detection (old APKs + website)

```typescript
// src/lib/nativeRecorder.ts
let capsP: Promise<{ localCapture: boolean; version: number }> | null = null;
export function nativeCapabilities() {
  if (!isNativeApp()) return Promise.resolve({ localCapture: false, version: 0 });
  return (capsP ??= MeetingRecorder.capabilities()
    .then((c) => ({ localCapture: !!c.localCapture, version: c.version ?? 2 }))
    .catch(() => ({ localCapture: false, version: 1 }))); // UNIMPLEMENTED on old APKs
}
```

- `Recorder.tsx`: use native-local when `inApp && caps.localCapture && (effective === "moonshine" || effective === "whisper") && source !== "sample"`. Otherwise keep the current web path. On the website `isNativeApp()` is false, so nothing changes.
- `useNativeRecorder.apply` and `Recorder.nativeMode`: **ignore states where `mode === "local"`**. Otherwise the cloud UI hook takes over the screen (`nativeRec.isRecording` would become true). Old APKs never send `mode`, so a missing mode means cloud.
- `useBackgroundRecording` and `recordingFlag.isRecordingActive` (back button minimises) already work for both modes through `getState().active`.

### Pattern 6: Survive renderer death (MainActivity)

```java
// MainActivity.onCreate after super.onCreate(): keep the process (and RecordingService) alive.
getBridge().addWebViewListener(new com.getcapacitor.WebViewListener() {
  @Override public boolean onRenderProcessGone(android.webkit.WebView v, android.webkit.RenderProcessGoneDetail d) {
    android.util.Log.w("MainActivity", "WebView renderer gone, crashed=" + d.didCrash());
    runOnUiThread(MainActivity.this::recreate); // fresh Bridge + WebView; the page resumes via listCaptures()
    return true;
  }
});
```

Source: the WebViewClient reference ("`true` if the host application handled the situation… otherwise, application will crash… or be killed") and `BridgeWebViewClient.java` L92-104 (Capacitor 8.6.2 delegates to `WebViewListener`s). Whether `recreate()` re-inits cleanly is MEDIUM, so verify it on the device. Alternative: `finish()` + `startActivity(getIntent())`.

### Anti-Patterns to Avoid
- **Calling `start({mode:"local"})` without `capabilities()`:** an old APK silently starts a Deepgram recording, which fails offline.
- **Feeding all the backlog at once:** it piles up `transcribeFinal` jobs (memory) and every embedding is skipped as "backlog". Pace it (Pattern 2).
- **Advancing or deleting audio before the parts are saved:** a kill between the two loses phrases. Cursor and parts go in one Dexie transaction, and release happens after.
- **Running `getUserMedia` and native `AudioRecord` together:** two capture clients, and Android may silence one. Native local mode never calls `getUserMedia`.
- **Storing audio in `getCacheDir()`:** the OS may delete it under storage pressure in the middle of a meeting.
- **Timer-driven pump while hidden:** throttled to about one tick per minute. Drive it with promises.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VAD / phrase segmentation for native audio | A Java VAD or a new TS segmenter | `VoiceChunker` feed mode | Tuned thresholds (noise floor, short-phrase joins, 15 s splits) already proven |
| ASR / embeddings in the service | sherpa-onnx / ORT-Android in Java | Existing worker | Second runtime and model store (Option C) |
| Speaker clustering on resume | New clustering | `createOnline` + `assignOnline` replay, `refine` at stop | Same math as the live path |
| Durable offline queue for transcript upload | A new outbox | Existing Dexie + `sync.ts` (`putParts` → `poke`/`flush`) | Already handles offline, auth and conflicts |
| Audio compression | MediaCodec Opus + WebCodecs decode | Raw PCM, deleted as consumed | 115 MB/h is fine with rolling deletion |

## Runtime State Inventory

Not a rename or migration phase. The only new runtime state: `noBackupFilesDir/offline-rec/*` folders (created by new APKs only, deleted by `discardCapture`) and the Dexie fields `nativeCapture` / `nativeCursor` (non-indexed, so no migration). Installed APKs need an **APK rebuild and re-share** (native change). There is no `cap sync` package change, since no new plugins are installed.

## Common Pitfalls

### Pitfall 1: Old APK + new web code starts Deepgram instead of local
**What goes wrong:** `MeetingRecorder.start` on a v1 APK ignores `mode`, needs `baseUrl`, and streams to Deepgram (fails offline, "Connecting to Deepgram…").
**How to avoid:** `nativeCapabilities()` gate. On v1, use today's web path for on-device engines.
**Warning signs:** "Connecting to Deepgram…" status while an on-device engine is selected.

### Pitfall 2: Catch-up skips every speaker embedding
**What goes wrong:** the worker's `queueEmbed` computes `slow = switching || downgraded || busyFraction(...) > 0.85` and `embedDecision` returns `"backlog"` when `finalsWaiting >= 2` (`speech.worker.ts` L303-311, `embedSchedule.ts`). During catch-up the worker is close to 100% busy, so **every embedding is skipped as "slow"** and the catch-up part has no speaker labels.
**How to avoid:** add a `batch` flag: `transcribe` message `{ ..., embed: true, batch: true }` → `embedDecision({ ..., batch })` ignores `slow` and `finalsWaiting` (the pump already paces). Keep `short` and `unavailable`. Unit-test in `tests/embedSchedule.test.ts`. The crop still follows `cropSecFor` (3 s on slow phones).
**Warning signs:** `speakerStatus` stuck on "catching-up". All parts after the lock end up as one speaker until refine.

### Pitfall 3: Live previews and model downgrade during catch-up
**What goes wrong:** `previewTick` sends partials while catching up and wastes CPU. `trackSpeed` judges the per-phrase RTF, which is fine, but thermal throttling over a long catch-up may still switch to Tiny.
**How to avoid:** disable previews while `catchingUp`. Accept the downgrade (it is the designed behaviour) and keep the existing "switched to the faster model" status.

### Pitfall 4: Catch-up can take nearly as long as the meeting on the phone
**What goes wrong:** per phrase (~5 s of speech) the phone pays ASR (RTF unknown on the Xiaomi phone, single-thread WASM in the APK, see CLAUDE.md SAB note) plus an embedding (UNMEASURED: 1-3.6 s per 3-6 s crop, 04-BENCHMARK.md "Phone estimate"). One hour locked could take 30-90 min to catch up if JS was frozen.
**How to avoid:** honest status with an ETA (seconds of audio left × a measured rate). Keep catching up while the page is hidden (the FGS keeps the CPU awake). The meeting is still finalised correctly if the user stops early: Stop drains everything. Measure in UAT. If it is too slow, a later phase considers Option C.
**Warning signs:** catch-up ETA grows instead of shrinking while the screen is on (RTF > 1).

### Pitfall 5: Renderer OOM kill crashes the whole app (and the recording)
See Q1 and Pattern 6. HIGH (official docs). It already applies to the cloud path. Local mode makes it more likely.

### Pitfall 6: `recoverOrphans` finalises a meeting that is still being captured
See Pattern 3. `SyncProvider.tsx` L72 runs `recoverOrphans(userId, isRecordingId, PAGE_LOADED_AT)` on load, before Record re-attaches.

### Pitfall 7: Leaving the Record screen stops the recording
**What goes wrong:** `useRecorder`'s unmount effect calls `stopRef.current()` (`useRecorder.ts`, last `useEffect`).
**How to avoid:** in native-local mode, unmount **detaches** (stop pumping, keep capture). Remount resumes through Pattern 3. Transcription then runs only while Record is mounted. Record is the `/` start page the app opens on, which is an acceptable MVP. A layout-level session controller is a later improvement (Open Question 2).

### Pitfall 8: Pause stitched into a phrase
See Q3 "Pause boundaries" (native `breaks`).

### Pitfall 9: MIUI battery saver kills the FGS process
Same as for cloud. The existing `batteryStatus` / `requestUnrestrictedBattery` banner (`useBatteryRestriction`) must also show for local mode. After a process kill Android does not let the app restart a microphone FGS from the background (Android 14 while-in-use rule), so the files are kept and the UI says where the gap starts (`interrupted`).

## Battery / CPU on the Xiaomi phone

| Work | Cost | Confidence |
|------|------|------------|
| AudioRecord 16 kHz + file append + fsync every 5 s | Low (a few % of one core), the same as the proven cloud capture minus networking | MEDIUM |
| No Wi-Fi lock / no WebSocket in local mode | Saves power compared with cloud mode | HIGH |
| ONNX ASR + embeddings while the screen is off (if JS keeps running) | Same CPU as screen-on recording, single thread. The dominant drain | LOW (unmeasured; UAT item) |
| Catch-up after unlock | Same total compute, just later. Phone warm and the screen on during catch-up | MEDIUM |

Default: transcribe whenever JS runs (spreads the work and gives a live transcript). If UAT shows heavy drain, a later option is "pause the pump while hidden, catch up on unlock" (a one-line condition on `document.visibilityState`).

## Code Examples

### Java: local sink in `captureLoop` (replace `backlog.add(bytes)`)
```java
// RecordingService.captureLoop, after computing bytes/level:
if (local) localCapture.append(bytes); else backlog.add(bytes);
recordedSamples += n;
```

### Java: reading a range (plugin thread)
```java
// LocalCapture.read(from, max): one segment at most, only flushed data
long head = headSamples; // volatile, set after flush
long end = Math.min(head, Math.min(from + max, segStart(from) + SEGMENT_SAMPLES));
int n = (int) Math.max(0, end - from);
byte[] out = new byte[n * 2];
try (RandomAccessFile f = new RandomAccessFile(segFile(segStart(from)), "r")) {
  f.seek((from - segStart(from)) * 2); f.readFully(out);
}
```

### TS: committed cursor (pure, testable)
```typescript
export function committedCursor(a: { readPos: number; openStart: number | null; inFlightStarts: Iterable<number> }): number {
  let c = a.readPos;
  if (a.openStart !== null) c = Math.min(c, a.openStart);
  for (const s of a.inFlightStarts) c = Math.min(c, s);
  return c;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Start microphone FGS any time | Must be created while the app is visible (while-in-use) | Android 14 / targetSdk 34+ (project targets 36) | Start must come from the Record tap. No auto-restart after a kill |
| Chrome freezes background pages after 5 min | 1 min on Chrome Android (M139); WebView excluded | 2025 | WebView JS probably keeps running when the process is awake (MEDIUM) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hidden WebView JS keeps running while the FGS + partial wake lock is held (Capacitor doesn't pause; WebView not in Chrome's freeze experiment) | Q1, Battery | Low: the design falls back to catch-up on unlock |
| A2 | Under the FGS, the WebView renderer isn't killed more often than today | Pitfall 5 | Medium: mitigated by Pattern 6 + resume |
| A3 | Capacitor bridge handles ~430 KB base64 results per call without trouble | Pattern 1 | Low: lower `maxSamples` to 2-5 s |
| A4 | `Activity.recreate()` from `onRenderProcessGone` reinitialises Capacitor cleanly | Pattern 6 | Medium: fallback finish + restart intent |
| A5 | Phone catch-up speed (ASR + embed) is 0.5-1.5× real time | Pitfall 4 | UX only: an ETA is shown, and correctness doesn't change |
| A6 | `AudioSource.MIC` quality suits Moonshine as well as the WebView mic did (AGC differences) | Q3 | Low: A/B `VOICE_RECOGNITION` in UAT |
| A7 | Thresholds: refuse below 150 MB free, warn below 1 h, stop below 50 MB | Q3 storage | Low: tune |

## Open Questions

1. **Does the hidden WebView keep transcribing with the screen off?** Unknown. It decides whether users mostly see "live" or "catch-up". It can only be answered on the device (UAT 3). The design handles both.
2. **Should the pump move to a layout-level controller** so transcription continues while the user is on the Meetings page? Recommendation: not in this phase (Record is the start page). Note it for Phase 6/7 polish.
3. **Remote stop while offline/frozen** is noticed late, and audio after it is still transcribed. Recommendation: accept and document. Optional later: on stop detection, truncate parts after the server's stop time.
4. **Catch-up ETA rate:** use a rolling measured "audio seconds processed per wall second" instead of a constant.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | `npm test` (node:test) | ✓ | v24.19.0 | — |
| Java + Gradle wrapper | `android/gradlew assembleDebug` compile proof | ✓ (`java` 23 on PATH, `android/gradlew` present; Phase 1 built `app-debug.apk` this way) | 23 | Use the Android Studio JBR if AGP rejects JDK 23 (as Phase 1 did, per its summary) |
| Android device (Xiaomi) + `chrome://inspect` | Device UAT | User only (Claude runs no adb or emulator) | — | None: UAT is a human checkpoint |
| New npm/Gradle packages | — | none needed | — | — |

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (local mode makes no server calls) | — |
| V4 Access Control | yes (local) | Audio in app-private `noBackupFilesDir`. The plugin only reads `offline-rec/<id>`. Validate `meetingId` against `^[A-Za-z0-9_-]{1,64}$` before building paths (path traversal) |
| V5 Input Validation | yes | Clamp `from`/`maxSamples`/`before` to ≥ 0 and `maxSamples` ≤ 30 s. Reject non-matching ids |
| V6 Cryptography | no | (Files are protected by Android app sandboxing and file-based encryption at rest) |
| V8 Data Protection | yes | Raw meeting audio is never in Auto Backup (`noBackupFilesDir`), is deleted after transcription, and `discardCapture` runs on DONE. No audio leaves the device |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Path traversal via `meetingId` (`../`) | Tampering / Info disclosure | Id regex + canonical-path check that the file stays under `offline-rec/` |
| Leftover audio after delete/uninstall flows | Info disclosure | Discard on DONE. A Meetings delete of a local meeting also calls `discardCapture`. Uninstall removes app storage |
| Untrusted origin calling the plugin | Elevation | The bridge is only injected for the `server.url` origin (CLAUDE.md ground truth) |

## Files to Touch (verified paths)

| File | Change | Verified names |
|------|--------|----------------|
| `android/app/src/main/java/in/transcriber/app/recorder/RecordingService.java` | `EXTRA_MODE`, `local` flag, `begin()` branches, `captureLoop` sink, `beginStop`/`completeStop` local variants, statuses, post-stop notification, free-space watchdog, `onDestroy` interrupted | `ACTION_START/STOP/FORCE_STOP/PAUSE/RESUME`, `begin`, `captureLoop`, `beginStop`, `completeStop`, `shutdown`, `refreshStatus`, `buildNotification`, static `LOCK`, `recordedSamples`, `level`, `noSound` |
| `android/app/src/main/java/in/transcriber/app/recorder/LocalCapture.java` | NEW | — |
| `android/app/src/main/java/in/transcriber/app/recorder/MeetingRecorderPlugin.java` | `capabilities`, `readAudio`, `releaseAudio`, `listCaptures`, `discardCapture`. `start` passes `mode`/`engine` (`baseUrl` optional in local). `getState` adds fields | `start`, `startService`, `getState`, `batteryStatus` |
| `android/app/src/main/java/in/transcriber/app/MainActivity.java` | `onRenderProcessGone` listener | `onCreate`, `registerPlugin` |
| `android/app/src/main/java/in/transcriber/app/recorder/AudioBacklog.java` | no change (cloud only) | — |
| `src/lib/nativeRecorder.ts` | interface additions, `nativeCapabilities()` | `MeetingRecorder`, `isNativeApp`, `NativeRecorderState` |
| `src/lib/speech/voiceChunker.ts` | feed mode, `startAt`, `breakAt`, `openStart()` | `VoiceChunker`, `onFrame`, `flush`, `peek` |
| `src/lib/speech/nativeFeed.ts` | NEW pure helpers | — |
| `src/lib/speech/embedSchedule.ts`, `src/workers/speech.worker.ts`, `src/lib/speech/client.ts` | `batch` flag | `embedDecision`, `queueEmbed`, `transcribeFinal`, `send` |
| `src/lib/local/types.ts`, `src/lib/local/repo.ts` | `nativeCapture?`, `nativeCursor?`; `putParts(..., extra)`; `recoverOrphans` skip; `createLocal` accepts `nativeCapture` | `LocalMeeting`, `NewLocalMeeting`, `putParts`, `recoverOrphans`, `createLocal` |
| `src/hooks/useRecorder.ts` | `source "native"` branch in `start`, pump, `stop` drain, unmount detach, `resumeNative(id)` | `start`, `startMoonshine`, `stop`, `save`/`saveLocal`, `tick`, `cleanupMedia`, `refineSpeakers` |
| `src/hooks/useNativeRecorder.ts` | ignore `mode === "local"` | `apply` |
| `src/components/Recorder.tsx` | choose native-local, catch-up status, battery banner in local mode | `nativeMode`, `webRec`, `nativeRec`, `battery` |
| `tests/nativeFeed.test.ts` (new), `tests/embedSchedule.test.ts`, `tests/voiceChunkerFeed.test.ts` (new) | unit tests | — |

## Recommended Plan Split (waves)

- **Wave 1 (parallel)**
  - **08-01 Native local capture** (Java): `LocalCapture.java`, `RecordingService` local mode, the five plugin methods + `getState` fields, `MainActivity` renderer-gone listener. Proof: `android/gradlew assembleDebug` succeeds. No install.
  - **08-02 Pure JS core + worker flag**: `nativeFeed.ts` (b64 decode, framing, `committedCursor`, ETA text), `VoiceChunker` feed mode + `openStart`/`breakAt`/`startAt`, `embedDecision` `batch` + worker/client plumbing, `nativeRecorder.ts` types + `nativeCapabilities()`. Proof: `npm test` (new tests) and `npx tsc --noEmit`.
- **Wave 2**
  - **08-03 Recorder integration**: `useRecorder` native source (start / pump / pacing / stop drain / detach / resume), Dexie `nativeCapture`/`nativeCursor` + `putParts` extra + `recoverOrphans` skip, `useNativeRecorder` mode filter, `Recorder.tsx` selection + statuses ("Recording on this phone — works offline and with the screen locked", "Catching up · 12 min of audio left", "Finishing transcription… N min left").
- **Wave 3**
  - **08-04 Recovery, stop paths, storage, UAT**: `listCaptures` on Record mount (resume active, finalize stopped/interrupted), notification-stop finalisation, remote-stop wiring check (`markRecording`), free-space messages, `discardCapture` on DONE and on local delete, `08-HUMAN-UAT.md`. Rebuild the APK (user re-shares).

## Device UAT Checklist (for 08-HUMAN-UAT.md; run by the user on the Xiaomi phone)

1. **Capability gating:** an old APK + new site: an on-device recording behaves exactly as before (web mic). Website on a laptop: unchanged.
2. **Airplane mode, 1 h locked:** new APK, airplane mode, Moonshine, start, lock immediately, speak or play a meeting for 60+ min, unlock. Expect no hole in the timeline (check the `t` of the parts around the lock period) and the notification visible throughout.
3. **Does JS run hidden?** In `chrome://inspect`, watch the worker console (`[speaker] embedMs=`) and the parts count while the screen is off for 5 min. Note live vs catch-up.
4. **Catch-up:** if a backlog exists after unlock, "Catching up · N min" decreases. Note the minutes needed per minute of backlog. Speaker labels exist on catch-up parts (Pitfall 2 fix).
5. **No duplicates:** search the transcript around lock/unlock and resume points for repeated sentences.
6. **Notification Stop while locked** (offline): the meeting finalises after opening the app, and `offline-rec/<id>` is gone (check via the "storage used" indicator or `listCaptures()` in the console).
7. **In-app Stop with backlog:** Stop drains everything, then "Saved on this device…" appears, and it syncs once online.
8. **Remote stop:** stop from the laptop Meetings list while the phone is online and unlocked. The phone finalises.
9. **Kill recovery:** swipe the app away during recording (the FGS should survive, `stopWithTask=false`). Reopen: it re-attaches. Then force-stop from Settings: on reopen, "Recording was stopped by Android at mm:ss", what was captured is transcribed, and no orphan DONE appears before resume.
10. **Pause/Resume from the notification while locked:** no phrase spans the pause, and the clock excludes the pause.
11. **Battery:** % drop per hour locked (record airplane-mode cloud-off numbers) and phone temperature.
12. **Storage:** with low free space (<1 h), a warning appears. Below 50 MB, capture stops cleanly.
13. **Navigate away** to Meetings during recording and back: the recording continues and the transcript catches up.

## Sources

### Primary (HIGH confidence)
- Repo source read in this session: `RecordingService.java`, `MeetingRecorderPlugin.java`, `AudioBacklog.java`, `MainActivity.java`, `AndroidManifest.xml`, `variables.gradle`, `capacitor.config.ts`, `useRecorder.ts`, `useNativeRecorder.ts`, `useBackgroundRecording.ts`, `nativeRecorder.ts`, `native.ts`, `voiceChunker.ts`, `resampler.ts`, `client.ts`, `speech.worker.ts`, `embedSchedule.ts`, `local/db.ts|types.ts|repo.ts|sync.ts|syncCore.ts|stopRemote.ts`, `recordingFlag.ts`, `recordingState.ts`, `Recorder.tsx`, `MeetingList.tsx`, `MeetingView.tsx`, `SyncProvider.tsx`, `public/sw.js`
- Capacitor 8.6.2 Android source: `Bridge.java` (onPause/onResume, shouldKeepRunning L463), `cordova/MockCordovaWebViewImpl.java` (handlePause/setPaused), `BridgeWebViewClient.java` (onRenderProcessGone L92-104), `WebViewLocalServer.java`
- https://developer.android.com/about/versions/pie/android-9.0-changes-all (background apps cannot access the microphone; use an FGS)
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start (while-in-use microphone FGS rules, Android 14)
- https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone (return value semantics)
- https://developer.android.com/reference/android/webkit/WebView (RENDERER_PRIORITY_IMPORTANT is the default binding)
- `.planning/phases/04-on-device-speaker-separation/04-BENCHMARK.md` (embedding costs, unmeasured phone estimate)

### Secondary (MEDIUM confidence)
- https://groups.google.com/a/chromium.org/g/blink-dev/c/NXZ_aTNzR2w ("Faster background freezing on Android": WebView excluded)
- https://groups.google.com/a/chromium.org/g/blink-dev/c/8En_5DqV_fU/m/fKD_sQRiAwAJ (intensive timer throttling)
- https://developer.chrome.com/blog/background_tabs (background timer budget; audio-playing pages exempt)

### Tertiary (LOW confidence)
- Behaviour of hidden-WebView `getUserMedia`/AudioContext under an FGS: not documented. Device test required.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependencies; all existing code read)
- Architecture: MEDIUM-HIGH (reuses verified seams; bridge payload size and recreate behaviour assumed)
- Pitfalls: HIGH for 1, 2, 5, 6, 7 (code/docs); MEDIUM for 3, 4, 9 (device-dependent)

**Research date:** 2026-11-24
**Valid until:** 2026-12-24 (stable platform APIs; re-check if Capacitor is upgraded past 8.6.x)
