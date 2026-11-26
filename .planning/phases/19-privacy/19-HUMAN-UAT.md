# Phase 19: Human UAT

Use a throwaway account on the preview or local build, never the owner's real data.

## Consent
- [ ] Record screen shows "Tell everyone you're recording before you start." under the button; it disappears while recording.
- [ ] First tap on Record on this device opens "Recording others? Let them know first." Wording changes with the engine (on-device vs cloud).
- [ ] "Copy consent note" copies the note; paste it into WhatsApp to check.
- [ ] "Cancel" does not start a recording. "I'll tell them, start" starts it.
- [ ] Stop, record again: no dialog, starts at once. Same from the "Next up" card.
- [ ] Android app: kill the app mid-recording and reopen; recovery/auto-resume shows no dialog.
- [ ] Profile, Recording, "Copy consent note" works.

## Privacy page
- [ ] /privacy opens signed out (laptop and Android app), reads well in light and dark.
- [ ] Linked from the login page and Profile. Back button returns.

## Delete account
- [ ] Profile, Account, "Delete account" opens the dialog; the button stays disabled until DELETE is typed; offline it is disabled.
- [ ] While recording: deleting says "Stop the recording before deleting your account."
- [ ] Delete a throwaway account that has meetings, tasks, people, a plan and a booking link: lands on /login with "Your account was deleted."
- [ ] Signing in with that email says no account found. Check the database: no rows left for that user id (Meeting, ActionItem, ClientError, Booking, etc.).
- [ ] After a second sign-up on the same device, no old meetings, name or summaries appear.
- [ ] Offline models still work without a new download.
