# Unbuilt audit: back end with no screen (or only half of one)

Read-only audit of `src/lib` and `src/app/api` on branch `calendar-notifications` (2026-11-28). Line numbers are from this checkout. "UI missing" is what a user would need to reach the logic. Items 1 and 2 are addressed by the calendar and notification work on this branch (see CALENDAR-NOTIFICATIONS.md); the rest are left as is.

## No screen at all

| # | Where | What it does | UI missing |
|---|-------|--------------|------------|
| 1 | `src/app/api/calendar/mine/route.ts:14`, `src/lib/calendarDb.ts:47` (`busyIntervals`) | Returns the caller's own busy blocks (plans and bookings, with titles) and working hours for up to 14 days. | Only `suggestTimes()` in `src/lib/calendarClient.ts:73` calls it, to compute "Find a time". There was never a screen that shows your own calendar. (Now: the Schedule calendar. It reads `/api/plans`, `/api/schedule/bookings` and the local meetings instead, because `mine` is capped at 14 days and hides record links.) |
| 2 | `src/app/api/action-items/summary/route.ts:15` (`overdue`, `dueToday`, `open`) | Cheap counts for tasks. | Only the red Tasks badge and a once-a-day toast use `overdue`. `dueToday` is never shown anywhere. (Now: notification panel.) |
| 3 | `src/app/api/stakeholders/import/route.ts:9` | Bulk-adds up to 200 people, skipping repeated emails. | No import screen (CSV paste or file) on People. `PeoplePage.tsx` only has Add one at a time. |
| 4 | `src/app/api/series/[id]/route.ts:31` (DELETE) and `:10` (PATCH of `title`, defaults) | Deletes a series; renames it and changes default length, venue and call link. | `SeriesSettingsSheet.tsx` edits only cadence and keep-ahead. There is no way to rename or delete a series, or to edit its defaults. There is no list of all series anywhere (series only show up inside a plan). |
| 5 | `src/app/api/series/[id]/next/route.ts:15`, `src/lib/calendarDb.ts:120` (`ensureAhead`) | Plans the next meeting of a series; keeps N meetings planned ahead. | Reachable only from one plan's page. Nothing shows which series are "running low" or what was auto-planned. `ensureAheadForUser` also runs silently inside `GET /api/plans` (`src/app/api/plans/route.ts:28`), so merely opening Upcoming can create plans with no notice. |
| 6 | `src/app/api/book/ics/[bookingId]/route.ts:8` | Calendar file for a booking. | Guest-only (needs the cancel token). The host has no ".ics for this booking" in Upcoming (`ScheduleSettings.tsx` booking rows: Record and Cancel only). The host gets one only after the booking has a plan (`PlanPage.tsx:326`). |

## Partial screens

| # | Where | What it does | UI missing |
|---|-------|--------------|------------|
| 7 | `prisma/schema.prisma:124` `EventType` (`title`, `slug`, `description`, `active`, `bufferMin`, `minNoticeMin`, `maxDaysAhead`) and `src/app/api/schedule/settings/route.ts:67` (PUT up to 10 event types) | Several named booking types, each with its own link `/book/<handle>/<slug>`. | `scheduleSimple.ts:146` (`applyLengths`) collapses this to "one event per length". No screen to name an event, write a description, turn one off, or copy its own link. Guests are shown one generic title ("30 min meeting"). Buffer, notice and horizon are one value for all events. |
| 8 | `src/app/api/schedule/settings/route.ts:16` (`availability` is a list of ranges) | Several time ranges per weekday. | The simple editor has one range per day. A day with two ranges shows a "Custom hours" note and can only be reset (`ScheduleSettings.tsx`). No date-specific overrides or time off exist in the model at all. |
| 9 | `src/lib/calendar.ts:156` (`formFieldsAt`), `src/app/api/freebusy/route.ts:18` | Other users' busy time (opt-in), used for "Find a time" and conflicts. | Visible only inside a plan, and only after attendees are added. No "who is free" view on Schedule. The share switch lives on Profile (`ProfilePage.tsx:420`) with no hint on Schedule that it feeds this. |
| 10 | `src/lib/planIcs.ts:7`, `src/app/api/plans/[id]/ics/route.ts` | The .ics for a plan. | Per-plan only (`PlanPage.tsx:326`). No "export my calendar" or subscribe feed. |
| 11 | `src/app/api/plans/[id]/follow-up/route.ts`, `src/lib/followUpDb.ts:92` | Plans the next meeting and carries unfinished tasks. | A button on a recorded plan and in a linked-plan card. Nothing tells you a recorded meeting still has no follow-up. (Now: notification panel, "Plan the next one".) |
| 12 | `src/lib/meetingExtras.ts:12` (`items`) | Action-item candidates from the combined AI request, kept on this device, waiting for review. | Reviewed only inside the meeting's Action items tab. Nothing outside the meeting says "3 tasks waiting". (Now: notification panel, device-local.) |
| 13 | `src/lib/planningDb.ts:100` (`createPlanForBooking`) | Every booking silently creates a plan with `bookingId`. | `PlanPage.tsx:456` shows a "From a booking" badge, but Upcoming on Meetings and Schedule list plans and bookings separately, so one booking can look like two entries. (The new calendar merges them.) |
| 14 | `src/lib/prework.ts`, `src/app/api/plans/[id]/references/*` | Reference files and AI points on a plan. | Fully reachable from a plan, but nothing on the calendar, Upcoming or Record screen shows that prework exists or is unfinished. |

## Feature flags that gate nothing visible

Checked all 17 keys in `src/lib/flagsCore.ts` against `useFlag`, `getFlagNow`, `isFlagOn` and `<FlagGate>`.

- None is completely dead: every key gates either a UI element or an API route.
- Server-only gates (no screen explains the "off" state; the user just sees the feature missing or a 503 message):
  - `meetingAsk` is read in `src/app/api/meetings/[id]/ask/route.ts:33` and `MeetingView.tsx:81`. Off, the Ask tab disappears silently.
  - `prework` is read in `src/lib/preworkDb.ts:20` plus two components; off, the API returns a generic "paused" error.
  - `calendar` and `followUpPlanning` hide their buttons (`useCalendarReady`, `PlanNextButton.tsx:35`) and answer 503 to direct calls, without any "paused" notice.
- `FlagGate` (the "paused" notice) is used only for Schedule and Plan pages. Everything else just vanishes.
- New in this branch: `calendarView` and `notifications`.
