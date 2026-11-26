# Phase 19: Privacy basics - Summary

Code complete 2026-11-26 on branch `polish-hygiene`. No new dependencies, no schema change, database never touched.

## Consent notice
- Record screen shows "Tell everyone you're recording before you start." under the record button while idle.
- First recording on a device opens a dialog (existing `Dialog`): "Recording others? Let them know first." with wording per engine (on-device: audio stays on the device and is not kept; Deepgram: audio goes to Deepgram, Minutely does not keep it). Buttons: "I'll tell them, start", "Copy consent note", "Cancel". The answer is stored per device in `minutely.recordingConsent`.
- Only the Record screen's two start buttons (main button, "Next up" card) go through `useConsentGate`. After the first time `gate()` runs the start synchronously. Native auto-resume, recovery and the sample demo do not use it.
- Profile, Recording has a "Copy consent note" button.

## Privacy page
- `/privacy` (`src/app/privacy/page.tsx`), outside the signed-in layout, no sign-in, dated 2026-11-26. Linked from the login page and from Profile (version line).
- Derived from code: Neon Postgres tables, IndexedDB/localStorage, audio never stored (Android service keeps a temporary PCM file until transcribed), Deepgram (cloud engine, audio direct from the device via a short-lived token), AICredits (GLM Flash / Claude Haiku) with Gemini as the backup, Vercel, Resend only when configured, Hugging Face for model downloads.

## Delete account
- Profile, Account, "Delete account" opens a dialog; the user types DELETE.
- `DELETE /api/profile` (`src/app/api/profile/route.ts`): session user only, body only carries `confirm: "DELETE"`; `FailureLimiter` 5 tries per hour per user; 503 on P2021/P2022; 401 without a session.
- `src/lib/accountDb.ts` deletes in one `$transaction`, in `ACCOUNT_DELETE_ORDER` (`src/lib/privacyCore.ts`): ActionItemEvent, ActionItem, PlanReference, PlannedAttendee, PlannedMeeting, MeetingSeries, Booking (host side, so guest name/email/note go), EventType, Availability, AgendaDraft, Stakeholder, Meeting, ClientError (no foreign key, so explicit), then User. Soft-deleted rows are hard-deleted. Every table except ClientError would also go through the database cascade.
- Not touched: `FeatureFlag` (global), the admin login (separate signed cookie, not a user).
- After success (`useDeleteAccount`): stop sync, delete the per-user Dexie database, remove this account's localStorage keys (`isAccountLocalKey`), clear the cached name, sign out, go to `/login?deleted=1` ("Your account was deleted."). Model caches stay. The service worker caches only app shell and static assets (`/api/*` is pass-through), so there is no user data in Cache Storage to clear.
- Blocked while recording (same check as sign-out: `recorder.isBusy()` or `isRecordingActive()`).

## Tests and checks
- `tests/privacy.test.ts`: 4 tests (delete order, DELETE word, local key rules, consent wording). Total 692 passing.
- tsc clean, lint 0 errors (149 warnings, was 147), build, check-build, smoke (adds `/privacy` 200 and `DELETE /api/profile` 401) all pass.

## Notes
- The deleted account's other devices keep their local copy until sign-out or app data is cleared (stated on the privacy page).
- Unsynced meetings that exist only on the device are deleted too; the dialog says "on this device".
