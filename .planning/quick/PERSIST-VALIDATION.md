# Persist recording + validation (branch recording-persist-validation)

## Recording across pages
- `RecorderProvider` (src/components/RecorderProvider.tsx) mounts once in `src/app/(app)/layout.tsx`, owns the single `useRecorder()`.
- Two contexts: stable actions (setOptions, getOptions, isBusy, wrappers) and fast state. Only `Recorder` and `RecordingPill` read the state; AppShell and other pages do not re-render on ticks.
- Record screen pushes engine/language/mic/source to the provider via `setOptions`; ignored while busy (`recorderOpts.ts`, tested). On return it freezes its engine to the running session's.
- Hook unmount cleanup (stop / native detach) now only runs on full unload; pagehide autosave and orphan recovery unchanged.
- `RecordingPill` is on every non-Record page: web/on-device recording from context, Android cloud service via the existing poll. Stop from the pill goes to `/` so Record queues minutes.
- Sign-out is blocked with a toast while recording/starting/finishing.
- `/meetings/[id]` is outside `(app)`: the one in-app link to it now uses `/meeting?id=` so a recording is never unmounted.

## Rules
- Email: `src/lib/emailRule.ts`. Register (route + login page) enforce it. `authorize` only applies it when no account exists, so existing accounts on other domains still log in.
- Password: `src/lib/passwordRule.ts` (8+, letter, number) on register only; `PasswordInput` eye toggle on login, sign-up/confirm, admin.
- Deadlines: `src/lib/deadline.ts` (`validateDeadline`). TaskDetail, ActionItems review (date picker, sends `dueDate`), PlanPage date. Server: PATCH action-item (changed values only) and meeting action-items save. Server clock is lenient (UTC-12) to avoid refusing users ahead of UTC.

## Risks
- Not tested on a device or in a live browser: the pill, recording across pages, and the native local-capture path should be checked on the APK.
- Auto-minutes queueing still lives in `Recorder`, so it happens when the user returns to Record.
