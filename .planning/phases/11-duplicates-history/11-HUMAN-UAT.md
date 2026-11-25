# Phase 11: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production.

## Before 2_history is applied (old database)
- [ ] Open a meeting, extract and save tasks twice: second save toasts "Saved 0 tasks · N duplicates skipped" (no duplicates created).
- [ ] Tasks page loads; delete a task from the expanded row: it disappears (hard delete).
- [ ] Expanded row shows no History section and no error.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Change a task status, owner, due date and note: History shows one line per change, newest first, with date and time.
- [ ] More than 5 changes: "Show more" reveals up to 20.
- [ ] Delete a task: it vanishes from Tasks and the meeting's Saved tasks; no error toast.
- [ ] Re-extract on a meeting with saved tasks: matching rows say "Already saved" and start unchecked; reworded ones say "Possible duplicate" and stay checked.
- [ ] Two near-identical tasks in one meeting show "Possible duplicate. Show the other"; tapping scrolls to the other; neither is deleted automatically.

## Other duplicates
- [ ] Two meetings with the same title, started within 10 minutes, similar length: both tagged "Possible duplicate" in Meetings.
- [ ] Same guest email booked twice the same day: both Upcoming rows tagged "Same guest booked twice".

## Leftovers
- [ ] Sign out with the network off (or blocked): toast "Couldn't sign out. Try again." and you stay signed in.
- [ ] Follow-up agenda: textarea is disabled while "Polishing…"; after it, "Undo polish" restores your earlier text.
- [ ] Follow-up agenda: Tab and Shift+Tab stay inside the sheet; closing returns focus to the button that opened it.
- [ ] A transcript with one phrase over 5000 characters still extracts when the server copy is empty.
- [ ] Android app: tags and chips are readable (3:1 contrast) in light and dark.
