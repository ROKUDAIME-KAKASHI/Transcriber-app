---
phase: 08
plan: 01
subsystem: android-native-recorder
requirements: [OFF-V2-01]
key-files:
  created: [android/app/src/main/java/in/transcriber/app/recorder/LocalCapture.java]
  modified:
    - android/app/src/main/java/in/transcriber/app/recorder/RecordingService.java
    - android/app/src/main/java/in/transcriber/app/recorder/MeetingRecorderPlugin.java
    - android/app/src/main/java/in/transcriber/app/MainActivity.java
---
# Phase 8 Plan 01: Native local capture Summary

RecordingService can now record offline to 5-minute PCM segment files (`mode: "local"`), and the plugin can read, release, list and discard them; `./gradlew assembleDebug` succeeds.

## What was built
- `LocalCapture.java`: segments `seg-<start 10 digits>.pcm` (4,800,000 samples each) and `meta.json` `{v,meetingId,engine,language,startedAt,state,stoppedReason,breaks,committed}` in `getNoBackupFilesDir()/offline-rec/<id>/`. Head is published only after a flush (1 s) and fsync (5 s); meta is rewritten atomically. Reads return at most one segment and 30 s; release deletes whole segments below the cursor. Ids are checked against `^[A-Za-z0-9_-]{1,64}$` and a canonical-path check. Reopening a meeting with audio on disk continues it (with a break).
- `RecordingService`: local mode keeps the microphone FGS, the partial wake lock and `captureLoop`, but skips OkHttp, WebSocket, sender, autosave, network callback and the Wi-Fi lock. Pause writes a break at the capture thread. Storage: refuse start under 150 MB (status error, service ends), warning status under 1 h of space, clean stop under 50 MB (`stoppedReason: "storage"`; a write failure does the same). Stop (app or notification) closes the files with no network and posts a normal "Meeting stopped" notification if audio is waiting. `onDestroy` marks the capture `interrupted`.
- `MainActivity`: `onRenderProcessGone` returns true and calls `recreate()`.

## Deviations
None. Cloud code paths only gained `if (local)` guards (`begin` signature takes a nullable base URL and engine).

## Verification
`cd android && ./gradlew assembleDebug`: BUILD SUCCESSFUL. No device test (UAT is the user's).

## Open risks
`recreate()` after renderer death is unverified on device (research A4). Partial last segment after a process kill is trimmed to whole samples only when reopened.
