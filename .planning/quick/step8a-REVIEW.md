# Step 8a (tab-audio) review

Scope: `git diff main..step-8a-tab-audio`. Checked tsc, 482 tests, build: all pass after the fixes.

## Mic-only path
Diff-traced start/stop/pause/resume/cleanup for source="mic": unchanged. Native paths untouched, stop/pause/resume/cleanup not in the diff. The mic branch has the same constraints, same stream push, same message ("Requesting microphone…"). Deps array gained `opts.source`/`opts.tabMic` (harmless).
Intended behaviour change on laptops only: with the selector shown (flag on, desktop browser) the old "Also capture tab audio" checkbox is hidden and `captureSystemAudio` is forced false. Flag off / app / phones: identical to before.

## Findings
- MEDIUM (fixed): picker or mic prompt answered after the user cancelled the start. `cancelStart` had already cleaned up, so the late display stream (or mic in tab mode) was pushed into `streamsRef` after cleanup and never stopped: capture indicator left on. Now the stream is stopped when the start token is stale.
- MEDIUM (fixed): "Stop sharing" during start-up (model download, creating meeting) was ignored by the `ended` handler (`wantRecordingRef` still false), so a recording began on a dead share (silent / mic-only). Now start refuses with a clear message if all tab audio tracks ended before recording begins.
- LOW (not fixed, pre-existing): the mic path has the same late-stream leak after cancel during the mic prompt. Left unchanged by request.
- LOW (not fixed): in tab mode, a denied microphone fails the whole start with the "Microphone access was denied" message and drops the share. Could degrade to tab-only.
- LOW (not fixed): a late `/api/plans/:id` response can override the user's manual source choice.

## Verified OK
1. Tracks: video stopped at once; no-audio case stops all; stop/error/unmount all go through `cleanupMedia` (streamsRef incl. tab stream, ctx closed). Mixed destination dies with ctx.
2. `ended`: handler gated by `wantRecordingRef`; `stop()` sets it false synchronously, `track.stop()` does not fire `ended`, so no double stop or race with manual Stop.
3. Picker cancel: NotAllowedError -> TabAudioError -> catch path (cleanupMedia, discardEmptyLocal, isStarting false) with the friendly message; startingRef reset in finally.
4. No await before `getDisplayMedia` on web (the isNativeApp await is skipped; AudioContext and createLocal are sync/unawaited). The TypeError retry follows a synchronous rejection.
5. Mix: dest on the recorder's own ctx, read via VoiceChunker (PCM, ctx rate) for Moonshine, Whisper and Deepgram alike. No MediaRecorder involved.
6. Capability: native, no getDisplayMedia, coarse pointer, mobile UA all hide it; computed in an effect (no SSR mismatch).
7. Plan preselect only sets the source and shows Join call. Start still needs the main Record tap.
