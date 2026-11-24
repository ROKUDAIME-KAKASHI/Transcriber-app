---
phase: 08
plan: 04
subsystem: recovery-stop-paths
requirements: [OFF-V2-01]
key-files:
  created: [.planning/phases/08-offline-locked-recording/08-HUMAN-UAT.md]
  modified:
    - src/hooks/useRecorder.ts
    - src/lib/speech/nativeSession.ts
    - src/lib/local/stopRemote.ts
    - src/lib/nativeRecorder.ts
    - src/components/Recorder.tsx
    - src/components/MeetingList.tsx
    - src/components/MeetingView.tsx
    - src/components/RecordingPill.tsx
    - tests/nativeSession.test.ts
---
# Phase 8 Plan 04: Recovery, stop paths, storage, UAT Summary

Nothing recorded offline is lost or left behind: captures left on disk are finished when Record opens, every stop route ends in the same finalize, and the audio is deleted only after the write that clears `nativeCapture`. `tsc`, `npm test` (221) and `npm run build` pass; no Java changed in this wave, so no Gradle build was needed.

## What was built
- `resumeNative` now also handles stopped/interrupted captures whose row still has `nativeCapture = 1`: `attachExisting` in finalize mode, then `stopNative` (pump to `ended`, flush, finals, refine, DONE + clear flag, `discardCapture`). Status carries "Recording was stopped by Android at mm:ss. Transcribing what was recorded." (or the storage variant). Folders of finished meetings (DONE, flag cleared) are discarded as orphans; folders with no row in this user's store are never touched. If the audio cannot be fully read, the meeting is not marked DONE and the flag stays.
- Stop routes: notification Stop is seen by the 500 ms tick (service no longer active) and runs the same finalize; remote stop reuses `handleRemoteStop` -> `stopNative`; the pill's Stop in local mode stops the service and opens Record; Meetings list and meeting page "Stop recording" return `finish-here` for an unfinished offline recording (stop capture, open Record) instead of a server-only DONE, so it works offline; deleting a meeting discards its audio. The list shows "Needs finishing" instead of "Not responding".
- Storage: `storageNotice` (pure) drives a "Phone storage" Notice on Record (under 1 h of space left; storage stop), and a start the service refuses shows the service's own message.
- `08-HUMAN-UAT.md`: 14-step device checklist.

## Deviations
None beyond the commit-attribution note in 08-03.

## Known limits
Recovery runs when the Record screen mounts (the app's start page); a deep link straight to another page waits until Record is opened or the list's "Needs finishing" Stop is tapped. A remote stop that arrives while Record is not mounted is applied when the capture is next stopped here.
