---
phase: 08-offline-locked-recording
reviewed: 2026-11-24T00:00:00Z
depth: deep
files_reviewed: 26
files_reviewed_list:
  - android/app/src/main/java/in/transcriber/app/recorder/LocalCapture.java
  - android/app/src/main/java/in/transcriber/app/recorder/RecordingService.java
  - android/app/src/main/java/in/transcriber/app/recorder/MeetingRecorderPlugin.java
  - android/app/src/main/java/in/transcriber/app/MainActivity.java
  - src/hooks/useRecorder.ts
  - src/hooks/useNativeRecorder.ts
  - src/hooks/useBackgroundRecording.ts
  - src/lib/nativeRecorder.ts
  - src/lib/speech/nativeFeed.ts
  - src/lib/speech/nativeSession.ts
  - src/lib/speech/voiceChunker.ts
  - src/lib/local/repo.ts
  - src/lib/local/stopRemote.ts
  - src/app/api/speaker-names/route.ts
  - src/lib/nameDetect.ts
  - src/lib/nameSuggest.ts
findings:
  critical: 0
  warning: 6
  info: 3
  total: 9
status: issues_found
---

# Phase 8: Code Review Report (with Phase 7 and 6 spot checks)

Depth: deep. No data-loss or security blocker found. Six real defects were found and fixed in the same change set (marked FIXED).

## Warnings

### WR-01 (high, FIXED): readAudio could report `ended` against a stale head and drop the last second of audio
`LocalCapture.java` read(): `head` was read before the "is the capture over" test. `finish()` publishes the final head and then flips the state, so an interleaving gave `ended=true` with an old `head`; the page then declared the stream drained and skipped up to FLUSH_MS (1 s) of the tail. Fix: evaluate `over` first, then read `head`.

### WR-02 (high, FIXED): "Stop recording" on a native row could stop a different meeting
`stopRemote.ts` and `stopNative` in `useRecorder.ts` sent `MeetingRecorder.stop` unconditionally. The plugin's `send()` stops whatever the service is running, so finishing an old unfinished capture (or tapping Stop on a "Needs finishing" row, or resumeNative finalising an interrupted capture while a cloud/other session is live) would end the live recording. Fix: stop only if `getState` shows `active && mode=="local" && meetingId==id`.

### WR-03 (medium, FIXED): rows could be stuck on "Needs finishing" forever
A row is created with `nativeCapture=1` before the model download and before the service creates its folder. If the app dies in between there is no audio folder, `recoverOrphans` skips the row (nativeCapture===1), and Stop just routes to "/" where nothing finishes it. Fix: `resumeNative` releases claims for rows with no folder and idle for 10 min (`releaseStaleNativeClaims`), and `stopRecordingRemotely` clears the claim and falls through to the normal stop when the folder is gone.

### WR-04 (medium, FIXED): `releaseAudio` accepted `before` beyond the head
`LocalCapture.release()` stored any `before` as `committed`. After a full release the head is rebuilt from `committed` (scanHead), so an over-large value would make a restarted writer start mid-segment with misaligned file offsets. Fix: clamp to `head`.

### WR-05 (medium, FIXED): newline forging of transcript lines in the speaker-names prompt
`/api/speaker-names` interpolated `l.text` (up to 500 chars, newlines allowed) and `named` values into the prompt, so a transcript line could contain "\nSpeaker 2: ..." and fake structure. The evidence check still ran on the original lines, so impact was limited to chips, which need a tap. Fix: collapse whitespace per line and per name.

### WR-06 (low, not fixed): evidence check is weak for short names
`validateAiSuggestions` accepts evidence that equals just the name and matches any line by substring (no word boundary, any speaker's line). Name chips still need a user tap, so risk is cosmetic. Suggest requiring evidence of at least 2 words and word-boundary matching.

## Info

### IN-01: folders with no device row are never cleaned
`pickCapture` deliberately ignores folders without a row (could belong to another user). A failed start whose `discardCapture` is refused (service still stopping, 2 s timer) leaves a folder forever. Consider a TTL sweep for stopped folders older than N days.

### IN-02: getState holds RecordingService.LOCK while taking LocalCapture.lock
`getState` calls `lc.committed()`/`stoppedReason()` (synchronized) inside `synchronized(LOCK)`. No deadlock exists (the writer never takes LOCK while holding the capture lock), but a 5 s fsync in append stalls other LOCK users briefly. Read those values outside LOCK.

### IN-03: mic reopen mid-meeting is not marked as a break
In `captureLoop`, when AudioRecord is lost and reopened the audio stays contiguous in the file with no break, so the VAD chunker may join speech across the gap. Minor.

## Checked and found sound
- Path traversal: meetingId validated by `^[A-Za-z0-9_-]{1,64}$` plus canonical-path check; `matches()` is anchored.
- Old APK: `nativeCapabilities()` false means the web microphone path with the selected on-device engine; Deepgram is only used when the user picked it, and `useNativeRecorder` ignores `mode:"local"`.
- Cursor ordering: cursor and parts are computed in the same tick and written in one Dexie transaction; `releaseAudio` runs only after the write succeeds; DONE clears `nativeCapture` in the same write and the folder is discarded afterwards (orphans are swept by `pickCapture`).
- detach/remount: `detachBarrier` is set synchronously in cleanup, before the next mount's effect; the open phrase is not flushed, the cursor stays at `openStart`.
- Memory: reads are capped at 30 s (about 1.3 MB base64).
- speaker-names route: auth first, zod caps (400 lines, 500 chars, 20k total, 100 named keys), 45 s timeout, evidence validated server-side.
- Cloud path in RecordingService: `local` false everywhere it matters; behaviour unchanged.

_Reviewer: Claude (gsd-code-reviewer)_
