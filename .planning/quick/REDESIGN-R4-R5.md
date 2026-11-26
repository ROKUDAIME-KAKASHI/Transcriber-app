# REDESIGN-R4-R5 (branch redesign-r4-r5): Tasks, People, Schedule, Profile, Ctrl/Cmd+K

Visual and wiring to existing data and APIs only. No schema, API route or dependency changes.

## R4
**Tasks** (`TaskTracker.tsx`, new `TaskDetail.tsx`, `lib/taskView.ts`)
- New subtitle; overview strip (Open, Not started, In progress, Blocked, Done) from the existing `statusCounts`, so it follows the owner/meeting/series filters. Status chips, owner, meeting and series filters, timeline view, duplicate hint, link-owners notice, agenda button all kept.
- Compact rows: title, owner, due (`.num`; danger text plus "Overdue" when late, "Said: ..." when only deadline text exists), status pill, source-meeting link. The whole row opens the detail via a stretched title button; the meeting link sits above it.
- Detail: right panel at 1024px+, bottom sheet below. Edits title (the PATCH already allows it), status, due date, owner (PersonPicker), progress note; shows source quote, the existing history list, meeting link, series chip, and Delete with a confirm. Esc, backdrop and the Android back key close it (overlay stack); Tab is trapped; focus returns to the row. Fields are disabled offline. The timeline's "open" now opens the same detail.
- Empty text per filter (`emptyTasksText`): "No open tasks. You're all caught up.", "Tasks from your meetings will appear here."
- Not done: browser Back does not close the panel (no history entry is pushed). No create (none exists).

**People** (`PeoplePage.tsx`)
- Two-letter initials avatar (`initials`), compact rows (designation · organisation · email on one line, area badge kept). Search already covered name, email, designation, organisation and area; placeholder now says so.
- Add/Edit sheet: errors sit under their field (name required, email already used, server email error), a similar name is an inline warning plus the existing "Save anyway"; focus trap and focus restore added. Duplicate protection unchanged. No meeting counts or last interaction: the API doesn't return them.

## R5
**Schedule** (`ScheduleSettings.tsx`, `lib/scheduleSimple.ts`)
- Subtitle; the link card keeps URL, Change (slug edit), Share (`shareText`: native share, `navigator.share`, else copy); Copy now shows "Copied".
- Weekly hours: one row per day with a switch and from/to times (`weekFromAvailability`, `availabilityFromWeek`, `weekProblem`). The backend already stores one range per weekday, so different hours per day work. A day with two saved ranges still shows the old "Custom hours" note. Time zone line and picker kept; meeting lengths and the existing "More options" untouched.
- Upcoming bookings: two-line compact rows (date/time/length, then guest); expand, Record and Cancel kept.

**Profile** (`ProfilePage.tsx`, `ui.tsx` `SwitchButton`, `DeviceTag`)
- Order: Account, People link, Booking (Copy with "Copied", Share, "Open Schedule"), Preferences (theme, reduce motion, overdue reminders, free/busy), Recording (offline models, screen-naming beta), App. "This device" tag on theme, reduce motion, overdue reminders, offline models and screen naming. Free/busy is an account setting, so untagged.

**Command palette** (`CommandPalette.tsx`, `lib/commandMatch.ts`, `AppShell.tsx`)
- Ctrl/Cmd+K toggles it; only when not native, at 1024px+ with a fine pointer. `next/dynamic` loads it on first open. Sidebar button shows "Ctrl K" or the Mac symbol (not rendered in the APK).
- Commands: Start recording (navigates to `/`, there is no safe auto-start hook), Toggle theme, Go to Meetings/Tasks/Schedule/People (respecting flags)/Profile, meetings by title from the local Dexie list, people by name (opens `/people?q=name`, which now seeds the People search; there is no per-person route).
- ARIA combobox + listbox, arrows/Enter/Esc, Tab trapped, focus returned on close, registered in the overlay stack.

## Tests
`taskView.test.ts` (6: overview, counts vs filters, empty text, due view, people search, initials), `commandMatch.test.ts` (6), 3 added to `scheduleSimple.test.ts`. Whole suite 674 pass.

## Not checked
No browser or device pass: 360px, dark mode, panel animation, APK back key, real keyboard flow of the palette.
