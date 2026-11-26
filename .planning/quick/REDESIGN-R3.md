# REDESIGN-R3 (branch redesign-r3): Meetings list

Visual and wiring to existing functions only. No schema, API or dependency changes.

- Header: "Meetings" + new subtitle; stats (total, hours recorded, meetings in the last 7 days) from the loaded rows, each hidden when unavailable, `.num` numbers. Logic in `lib/meetingListView.ts` (`listStats`, `formatHours`).
- Search: instant, client-side, on title. `filterMeetings` also matches `text` if a row carries it, but the list data has no transcript text, so only titles match today. Empty result: "No meetings match “x”." + Clear.
- Grouping: `groupMeetings` over the existing `dateGroup` (Today / Yesterday / This week / Earlier); sticky small headers kept.
- Rows: one panel per group, hairline dividers, title / date · time · duration / chips. At most one status chip plus a separate "Minutes ready" (or "Report ready") badge from `template || document` (the old template chip was moved out of `RowChip`). Min height 56px, hover and focus states.
- "⋯" menu (`MeetingRowActions.tsx`): Rename and Delete, arrow keys, Esc returns focus. Rename uses `setTitle` (Dexie, then `poke`), falling back to PATCH like MeetingView. Delete uses `tombstone` + `discardNativeAudio` + `poke` like MeetingView; the server delete is a hard delete, so "You can’t undo this." is accurate. Delete is hidden for rows still recording. Dialog: Esc, focus trap, restores focus, registered with the overlay stack (Android back), `rounded-modal`.
- Share left out: ShareMenu needs the full meeting (document/transcript), which the list does not load.
- Kept: offline list, sync chips, "stop remotely" button, skeleton and empty states (first-run text now "No meetings yet. Press Record to capture your first one."), Upcoming plans.
- Tests: `tests/meetingListView.test.ts` (6). Not checked: no browser or device pass (360px, dark mode, APK back button).
