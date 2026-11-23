---
phase: 04-on-device-speaker-separation
reviewed: 2026-11-23T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/lib/speech/diarize.ts
  - src/lib/speech/embedSchedule.ts
  - src/lib/speech/models.ts
  - src/lib/speech/readiness.ts
  - src/lib/speech/client.ts
  - src/workers/speech.worker.ts
  - src/hooks/useRecorder.ts
  - src/lib/local/db.ts
  - src/lib/local/repo.ts
  - src/lib/local/sync.ts
  - src/lib/local/syncCore.ts
  - src/lib/local/types.ts
  - src/lib/transcript.ts
  - src/lib/export/deliver.ts
  - src/lib/export/docx.ts
  - src/lib/export/html.ts
  - src/lib/export/index.ts
  - src/lib/export/text.ts
  - src/app/api/meetings/[id]/process/route.ts
  - src/app/api/meetings/[id]/speakers/route.ts
  - src/components/SpeakerChip.tsx
  - src/components/RenameSpeakerSheet.tsx
  - src/components/TranscriptView.tsx
  - src/components/MeetingView.tsx
  - scripts/diarize-bench.mjs
  - tests/diarize.test.ts
  - tests/embedSchedule.test.ts
  - tests/syncCore.test.ts
findings:
  critical: 0
  warning: 7
  info: 3
  total: 10
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-11-23
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 4 adds speaker embeddings in the speech worker, online and stop-time clustering, name mapping, relabel sync and exports. The core design is sound. Finals keep priority over partials and embeddings. Embeddings are skipped, never queued deeply. Buffer transfer is correct: the audio length is read before the transfer, the worker copies the vector before transferring it, and the embedding message is always emitted exactly once on every worker path I traced. HTML export escapes every text node and attribute, and only http(s) links survive, so I found no injection. Old APKs and Deepgram are unaffected because all diarization is gated on `diarizeOnRef`.

The weaknesses are around the stop path and the relabel sync. Both can leave local and server speaker labels inconsistent, or delay persistence of the last phrases. The worker also loads the speaker model outside its own scheduler. No blockers were found.

## Warnings

### WR-01: Stop path delays persisting the final phrases by up to 10 s plus refine time

**File:** `src/hooks/useRecorder.ts:968-974` (and `src/lib/speech/client.ts:288`)
**Issue:** At stop, autosave is already stopped. The code awaits `refineSpeakers()`, which calls `drainEmbeddings(10_000)`, before the first `save("DONE")`. The last phrases, and every phrase since the last autosave tick, exist only in memory for up to about 10 s on a slow phone. If the user swipes the app away, the OS kills the WebView, or the tab closes, that text is lost. Before this phase the save followed the pending-segment await directly. The `visibilitychange` and `pagehide` handlers do not cover an OS kill.
**Fix:** Persist the transcript before the optional refinement, then persist again with the relabel.
```ts
await Promise.all([...pendingSegmentsRef.current]);
await save();               // device-first checkpoint of everything transcribed
await refineSpeakers();
// existing save("DONE") follows; it re-sends the relabelled parts
```

### WR-02: Relabel flag is set before the refined parts are written, so a sync in between ships stale labels with remapped names

**File:** `src/hooks/useRecorder.ts:485-490`, `src/lib/local/repo.ts:194-206` and `70-105`, `src/lib/local/sync.ts:231-245`
**Issue:** `refineSpeakers()` calls `setRelabel` (`relabelPending=1`, `dirty.speakers=true`, remapped names stored) and only later does `save("DONE")` write the refined parts via `putParts`. The sync engine runs concurrently. If a pass reads the row between those two writes, it sends the speakers step with the OLD parts from IndexedDB, labelled with the NEW names. It then clears `relabelPending` and `dirty.speakers`. The refined parts follow only as a tail PATCH from `savedParts-1`, so the earlier relabelled parts never reach the server. Names end up attached to the wrong people on the server and on other devices.
**Fix:** Write the parts and the relabel flag in one Dexie transaction. For example, give `putParts` an optional `relabel?: { names: Record<string,string>|null }` argument that sets `relabelPending`, `speakerNames` and `dirty.speakers` together with the new parts. Alternatively, call `setRelabel` after `putParts` resolves.

### WR-03: `clear: ["speakers"]` races with a rename made while the request is in flight, and a failed `getParts` drops the pending relabel

**File:** `src/lib/local/sync.ts:231-245`
**Issue:** `cur` is read before the PATCH. A rename made during the request (for example right after Stop while the flush is running) calls `setSpeakerNames`, which sets `dirty.speakers=true`. The success path then calls `applySyncResult({clear:["speakers"]})` unconditionally, which wipes the flag. The new name stays local and is never uploaded. The meta step has the same pattern. Separately, if `getParts` returns null while `relabelPending===1`, `speakersRequest` falls back to the names-only path. `clearRelabel` stays false but `dirty.speakers` is cleared. The pending relabel is then never retried until the next rename.
**Fix:** Compare a revision before clearing. For example, add `speakersRev` to the row, bump it in `setSpeakerNames` and `setRelabel`, and clear only if it is unchanged. When `relabelPending===1 && parts===null`, return `fail(...)` (retry) instead of sending names only.

### WR-04: Server-direct recording pushes refined labels fire-and-forget, with no retry and no tail resend

**File:** `src/hooks/useRecorder.ts:993-1006` (and `saveToServer` 250-287)
**Issue:** In the non-local path, `saveToServer` sends only `transcriptTail` from `savedParts-1`. Live relabels of earlier parts, and the whole stop-time relabel, reach the server only through a single `void fetch(.../speakers).catch(() => {})`. If that request fails (it is made right after a flaky save), the server keeps the stale live labels. The names are already keyed to the refined ids, so they point at the wrong speakers. The failure is silent and permanent.
**Fix:** Await the request with the same retry loop as the final save. Or send the refined labels in the final tail PATCH (`from: 0`) when `relabelDoneRef.current` is true.

### WR-05: Speaker model load and warm-up run outside the worker scheduler, which breaks the stated priority and can skew the slow-device check

**File:** `src/workers/speech.worker.ts:124-152` (warm-up at line 138)
**Issue:** `loadSpeaker` is kicked off at recording start. It downloads or reads the model and compiles the session. It then runs `embedWith` on 1 s of silence. None of this goes through `pump()`, so it competes with the first finals. On a phone with one thread this is a multi-second block of the worker's event loop, during which finals and partials are delayed. The first finals' `rtf` is measured by wall clock and can include this interleaving. That feeds `trackSpeed` and can push a phone onto Moonshine Tiny for no lasting reason. `WARMUP_PHRASES_IGNORED = 2` only partly covers this.
**Fix:** Defer session creation and warm-up until the queue is idle (call it from `pump()` when `finals`, `partial` and `embeds` are empty and `running` is false). Alternatively, exclude phrases that overlapped the speaker load from `trackSpeed` by setting a flag while `loadSpeaker` is in flight.

### WR-06: The rename sheet is anchored by visible-paragraph index, which shifts during live recording

**File:** `src/components/TranscriptView.tsx:108`, `198-224` (and `src/hooks/useRecorder.ts:365-390`)
**Issue:** `renaming.index` is the index within `visible`. In `tail` mode, `visible = paragraphs.slice(hidden)`, so the index moves as `hidden` grows. Live relabelling also merges or splits paragraphs while the sheet is open. The sheet then re-attaches to a different chip, or disappears while `renaming` stays set. The saved name still goes to the `speaker` captured at open, so the data is right, but the UI is wrong. Renaming while recording is an explicitly supported flow.
**Fix:** Key the open sheet by the speaker id (`renaming: { speaker }`) and render it at the first visible chip for that speaker. Or key paragraphs by the absolute index (`hidden + i`) and store that.

### WR-07: Speaker embeddings are stored but never read, and are not deleted on every removal path

**File:** `src/lib/local/repo.ts:208-232`, `407-408` (`applyPull` removal), `234-236` (`tombstone`), `src/hooks/useRecorder.ts:432-440`
**Issue:** `putEmbeddings` writes one 256-float row per phrase. `getEmbeddings` has no production caller, so this is dead storage that grows at about 1 KB per phrase. `purge` deletes the rows, but `applyPull`'s `plan === "remove"` branch deletes `meetings` and `transcripts` and leaves the embeddings. A meeting deleted on another device therefore leaves voiceprint-derived vectors on this device indefinitely. The same applies to anything that deletes the meeting row without calling `purge`.
**Fix:** In `applyPull`, add `db.embeddings` to the transaction and run `await db.embeddings.where("meetingId").equals(local.id).delete()` beside the other deletes. Either drop persistence of embeddings until a consumer exists, or add a consumer (re-cluster after the fact) and a retention rule such as deleting them once the meeting is DONE and synced.

## Info

### IN-01: `outstandingEmbeds` can leak if `postMessage` throws

**File:** `src/lib/speech/client.ts:218-227`
**Issue:** The id is added to `outstandingEmbeds` before `postMessage`. A synchronous failure (such as a detached buffer) rejects the promise but leaves the id registered. `isWorkerBusy()` then stays true, so model prefetch is refused, and every later `drainEmbeddings` waits its full timeout.
**Fix:** Wrap the `postMessage` in try/catch and `outstandingEmbeds.delete(id)` on failure, or add the id only after the post succeeds.

### IN-02: Diarization listener and state are not reset after a failed start or a normal stop

**File:** `src/hooks/useRecorder.ts:1199-1207`, `1263-1281`, `461-501`
**Issue:** `onEmbedding(handleEmbedding)` is subscribed during `start`. The failure `catch` calls `cleanupMedia` and `discardEmptyLocal` but not `resetDiarization`, so the listener and a late `diarizeOnRef = true` outlive the failed start. `refineSpeakers` only unsubscribes when `diarizeOnRef` was true. State is cleared only at the next `start()`. This is harmless today but easy to trip over later.
**Fix:** Call `resetDiarization()` in the start-failure catch. Unsubscribe unconditionally at the end of `stop()`.

### IN-03: Two clustering behaviours discard information without telling the user

**File:** `src/lib/speech/diarize.ts:174-207` and `272-298`
**Issue:** (a) Step 3 merges every single-phrase cluster into its nearest cluster when cosine > 0.2. That is a very low bar, so a real speaker with one embedded interjection is absorbed. (b) `remapNames` keeps only the first name when two named live speakers collapse into one final id. The other name is dropped silently.
**Fix:** Raise the 0.2 floor (for example to the AHC similarity of 0.3 or more) after checking it against the benchmark. When two names collide, keep the one with more parts, or join them ("Asha / Ravi"), and show a hint.

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
