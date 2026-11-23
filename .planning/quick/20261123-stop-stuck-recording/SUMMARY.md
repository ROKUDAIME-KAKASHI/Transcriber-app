---
status: complete
---
# Quick: stop a stuck recording from the Meetings panel

- recordingState.ts: pure helpers (stale after 2 min, canStopFromList, isStoppedReply) + tests/recordingState.test.ts
- PATCH /api/meetings/[id]: merges tail into a DONE meeting, never reopens it, replies `stopped: true, status: "DONE"`
- List + meeting page: "Stop recording" with confirm, "Not responding" label; PATCH DONE + local Dexie update
- useRecorder / useNativeRecorder: stop gracefully on remote stop, notice "Stopped from another device"
- RecordingService.java: parses autosave reply, runs beginStop(false); getState exposes stoppedRemotely
- Commit fbb7b53. typecheck, 181 tests, build pass; APK rebuilt, v2 signature verified, dist/Transcriber.apk.
