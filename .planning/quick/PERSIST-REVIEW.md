# Review: RecorderProvider (commit e3c82b3)

Reviewed by reading the diff and following callers. Nothing was run or tested on a device.

## Teardown map (Q1)

Routes outside `(app)`: `/login`, `/admin`, `/book/*`, `/meetings/[id]`, `/offline`.

- No in-app Link or `router.push` still goes to `/meetings/[id]`. The grep found none.
- `/book/...` is only shown or copied (ProfilePage, ScheduleSettings, FollowUpAgenda), not navigated to.
- `/login` is reached only through `useSignOut` (blocked while busy, see WR-02) and `AuthGate` (see CR-01).
- Full reloads that kill the recorder:
  - `ServiceWorkerManager` and `sw/register.ts:69` (guarded by `isRecordingActive`, which has gaps, see WR-02).
  - `ErrorReporter`'s Reload button.
  - `AdminClient`, which is outside `(app)`.
  - Next's own hard navigation when an RSC or chunk fetch fails (WR-05).

## CRITICAL

### CR-01: Session expiry unmounts the provider and stops the recording
`src/components/AuthGate.tsx:40-80`

- When `decision` becomes `redirect-login` (probe returns `ok-empty`), `holdForRecording` is still `false` on that render. The gate falls to `return <Skeleton />` at line 95. That unmounts `RecorderProvider`, and the hook's cleanup calls `stopRef.current()` or `detachNative()`.
- The async `isRecordingActive()` check only runs after the unmount. The "Your recording is safe and keeps running" banner can therefore never be reached for a web or on-device recording.
- Even when `holdForRecording` flips to `true`, the tree changes from `<>{children}</>` to `<><div/>{children}</>`. `children` moves from index 0 to index 1, so React remounts it. The provider is destroyed on that path too.
- `isRecordingActive()` also ignores `isStarting` and `saveState==="saving"`. A session blip during those phases redirects to `/login` mid-save.
- Fix:
  - Render one stable tree: `return <>{showBanner ? <Banner/> : null}{children}</>` for both `app` and the held case.
  - Decide the hold synchronously from `isWebRecordingNow()`.
  - Never return Skeleton or redirect while `recorderBusy` is true.
  - Include starting and saving in the flag (see WR-01).

## WARNING

### WR-01: `recorderBusy` and the web-recording flag miss the Saving phase
`src/lib/recorderOpts.ts:32`, `src/components/RecorderProvider.tsx:60`

- After a web Stop, `stop()` patches `isRecording:false` and `saveState:"saving"`. `finishing` is only set on the native path.
- During the save (up to several seconds, with 2/4/6 s retries):
  - `isBusy()` is false, so sign-out is allowed. The session is then dropped before `save("DONE")`, which falls back to a local-only save.
  - `setOptions` is no longer frozen.
  - The SW reload and AuthGate checks see "not recording".
- Fix: busy = `isRecording || isStarting || finishing || saveState==="saving"`. Also set `setWebRecording` for starting and saving.

### WR-02: Sign-out is not blocked for the native cloud recording
`src/hooks/useSignOut.ts:16`

- The Android cloud service state lives in `useNativeRecorder`, inside `Recorder`. `RecorderActions.isBusy()` knows nothing about it, and the pill's bg poll isn't consulted.
- Signing out from the Profile page or AppShell while the service records (screen on) clears the session. The service then uploads with a dead token.
- Fix: also `await isRecordingActive()` (it already queries the native `getState`) before signing out.

### WR-03: Pill Stop navigates only after the whole save finishes
`src/components/RecordingPill.tsx:38,104-107`

- `actions.stop()` resolves only after the final save (retries, speaker refinement). The pill unmounts immediately because `isRecording` goes false.
- `router.push("/")` fires later, with no visible state. The user can be yanked from whatever page they are on mid-edit, or from a different page after several seconds.
- If `stop()` rejects, the pill is already gone, so `setStopping(false)` does nothing and there is no feedback.
- Fix: push `/` right after calling `stop()` without awaiting the save. Or better, see WR-04 and drop the push.

### WR-04: Auto-minutes queueing still depends on Record being mounted
`src/components/Recorder.tsx:424-430`

- `enqueueAuto` runs only inside `Recorder`. If the recording ends away from `/`, no minutes are queued until the user visits Record. The ways it can end:
  - a native "stopped remotely" event
  - a failed or late `stop()`
  - the user navigating away after the pill push
  - an auto-stop
- `queuedMeeting` also resets on every remount. It stays safe only because `enqueue` dedupes by meeting id.
- Fix: move the effect into `RecorderProvider`. It already has `rec.meetingId`, `finished` and `words`. It needs `useLocalUser` and the flag.

### WR-05: Any render error, or a failed client navigation, now kills a recording from any page
`src/components/Providers.tsx:28`, `ErrorReporter.tsx:45`

- `ErrorBoundary` sits above the provider and there is no `error.tsx` anywhere under `src/app`. A render error in any `(app)` page replaces the whole tree and unmounts the recorder. Before this change only the Record page could do that.
- On flaky or offline networks, Next falls back to a full-page navigation when the RSC or chunk fetch fails. That is a real reload, and only `pagehide` autosave covers it (reload recovery).
- Fix:
  - Add `src/app/(app)/error.tsx`. Because it sits inside the layout, the provider survives.
  - Consider disabling or warning on navigation to non-precached routes while recording.

### WR-06: Stale finished recording and prefills leak into the next Record visit
`src/components/Recorder.tsx:364-398,412`, `RecorderProvider.tsx`

- The provider never resets after a recording is saved. A remounted Record screen shows the old transcript and "finished" card (`rec.meetingId`, `transcriptParts`) until Start, even days later. It used to be fresh on every visit.
- With a recording running, tapping a plan's Record button (`/?plan=X`) runs the plan prefill:
  - It stores the prefill, to be consumed by the next recording.
  - It calls `setAlsoSound(true)`. When the options unfreeze, source flips to "tab" and the next Start opens the share picker.
  - The UI shows "also sound" off while a tab-audio session is actually running, since local state resets on remount.
- Fix: add `reset()` to the actions, called when Record mounts idle with `saveState` saved or local. Ignore `?plan=` and `?title=` while busy, or show a "recording in progress" note.

### WR-07: Account switch while recording is not guarded
`src/components/Recorder.tsx:426-429`, `RecorderProvider.tsx`

- Session expiry on this tab followed by sign-in as another account (or a probe returning a different user) changes `useLocalUser()`.
- `autoUserId` is read at enqueue time, so the minutes job is queued under the new user. The meeting belongs to the old one, and the server or runner rejects it or loses the job.
- The hook's `userId` also changes under a live session.
- Fix: capture the user id at start (a ref in the provider) and use it for `enqueueAuto`. Refuse a user change while busy.

## INFO

### IN-01: Pill polls native state even while a web pill is shown
`src/components/RecordingPill.tsx:27`

- `useBackgroundRecording(away)` runs a 1 s bridge poll on every non-Record page even when the web pill shows.
- It is harmless, since it falls through only when `web.isRecording` is false. Pass `enabled = away && !web?.isRecording` to avoid it.
- Residual gap: native local capture in the finishing or draining phase (`isRecording` false, service active) shows `NativePill`. Its Stop calls `MeetingRecorder.stop` directly, bypassing the hook.

### IN-02: Commit ordering breaks bisect
`6559841` imports `@/components/RecorderProvider`, which only exists in `e3c82b3`. `6559841` does not build on its own.

### IN-03: `setOptions` busy check uses a render-stale ref
`src/components/RecorderProvider.tsx:53`

- `recorderBusy(recRef.current)` is evaluated when `setOptions` is called, but the updater runs at the next render.
- There is a one-render race: a push landing in the same tick as Start can slip through. It is low impact, because `start` reads opts at call time.

## Checked and OK

- **Stop-on-unmount (Q2):** the cleanup effect is the same code, now with only the provider as owner. It runs only on provider unmount (route-group exit or a CR-01 case). `pagehide` autosave and orphan recovery are untouched. In-app route changes inside `(app)` no longer unmount it.
- **Native attach and detach (Q3):**
  - `resumeNative` now runs once per app load, on any page, instead of once per Record mount. That is better for reload recovery.
  - `detachNative` runs only on provider unmount.
  - No double-attach: `useNativeRecorder` ignores `mode:"local"`, and the hook's `resumeTriedRef` prevents a second attach.
  - Cloud-mode capture is unchanged: `useNativeRecorder` stays in `Recorder` and the pill polls.
- **Remount effects (Q4):** `sessionLocked` and the frozen engine seed correctly from `resumedBusy`. `setOptions` is ignored while busy. Prefills (`?plan=`, `?title=`) are applied again on mount, which is the issue noted in WR-06. `enqueueAuto` is deduped. No second session starts.
- **Pill (Q5):** Pause and Resume call the hook through stable refs. Tap goes to `/`. Stop queues minutes only through the push to `/` and `Recorder` (see WR-03 and WR-04).
- **Re-render churn (Q7):** two-context split works. Only `Recorder` and `RecordingPill` subscribe to the tick state. `children` is a stable element, so other pages don't re-render. Actions are stable.

## Fixes

Applied on branch `recording-persist-validation`. tsc, `npm test` (684 pass), `npm run build` and `npm run check-build` pass. Nothing tested on a device.

- **CR-01:** `RecorderProvider` now wraps `AuthGate` in `(app)/layout.tsx`. `AuthGate` renders one tree shape (`{banner|null}{children}`) and holds the app synchronously while the recorder is busy, so a session blip never unmounts or redirects. Pure rule `holdAppForRecording` is tested.
- **WR-01:** `recorderBusy` includes `saveState === "saving"`. The provider sets the web-recording flag from it (starting, recording, paused, finishing, saving). Tested.
- **WR-02:** `useSignOut` also awaits `isRecordingActive()` (native service state).
- **WR-03:** Pill Stop calls `stop()`, opens `/` right away, and shows a toast if the stop rejects.
- **WR-04:** Auto-minutes queueing moved into the provider; removed from `Recorder.tsx`. The once-per-meeting guard is kept.
- **WR-05:** Added `src/app/(app)/error.tsx` (inside the layout, so the recorder survives). The service-worker `controllerchange` reload is skipped while recording. Other reloads were already guarded.
- **WR-06:** New `resetFinished()` action, called when Record mounts, hides a saved recording. `?plan=` and `?title=` are ignored when Record opens during a busy recording, and the plan's call-link autofill does not run while locked.
- **WR-07:** The provider records the account at session start. It stops the recording if another account signs in, queues minutes under the original account, and hides the old transcript from the new one. `useRecorder` keeps its local user fixed while busy, so the save stays under the original account.
- **IN-01:** The pill's native poll is off while the web pill is shown.
- **IN-02, IN-03:** Not changed. IN-02 is history only. IN-03 is low impact.
