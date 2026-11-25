# Phase 13: Planned meetings + series - Summary

**Status:** Complete in code, needs UAT and `4_planned_meetings` applied.
**Requirements:** PLAN-01, PLAN-02, PLAN-03
**Flag:** `plannedMeetings` (default on), Admin > Feature switches > "Planned meetings and series".

## What was built

- **Models** `MeetingSeries` (title, cadence NONE/WEEKLY/BIWEEKLY/MONTHLY, default length, venue, link, `deletedAt`), `PlannedMeeting` (title, start, length, time zone, venue, call link, agenda up to 8000, status PLANNED/RECORDED/CANCELLED, `meetingId` and `bookingId` unique, `deletedAt`) and `PlannedAttendee` (name, email, designation, role, optional `stakeholderId`). `meetingId`, `bookingId` and `stakeholderId` have no foreign key on purpose (meetings are created on the device first; a removed person keeps their name). Migration `prisma/migrations/4_planned_meetings/migration.sql` was generated offline with `prisma migrate diff` from main's schema. Additive only; `Meeting` is untouched.
- **API** (owner-scoped, zod caps, `no-store`, soft delete, 503 "Planning needs a database update" on P2021/P2022, 503 "paused" when the flag is off): `GET/POST /api/plans` (`?from=&to=&seriesId=`), `GET/PATCH/DELETE /api/plans/[id]` (PATCH replaces attendees when sent; status can only be set to PLANNED or CANCELLED), `POST /api/plans/[id]/link` (idempotent, a meeting id the server has not seen yet is accepted, one that exists must be the caller's), `GET /api/plans/[id]/ics` (owner only; attendees with an email become `ATTENDEE` lines with a quoted CN), `GET/POST /api/series`, `PATCH/DELETE /api/series/[id]`, `POST /api/series/[id]/next`, `GET /api/meetings/[id]/plan`.
- **Series:** "next" keeps the weekday and wall-clock time in the plan's time zone (DST safe: each date is computed from the first, a skipped spring-forward hour moves to the next hour; monthly keeps the n-th weekday, a 5th falls back to the last). Title, length, venue, link and attendees are copied; the agenda starts empty (Step 7 will carry unfinished tasks). Asking twice returns the meeting already planned for that time. A series with "Doesn't repeat" plans weekly.
- **Bookings:** a new booking also creates a plan for the host (title "<event> with <guest>", guest as attendee, booking agenda, `bookingId`) inside a try/catch that never fails the booking; cancelling a booking (host or guest) sets the plan to CANCELLED. Old bookings are not migrated.
- **Record from a plan:** the Upcoming row and the plan page link to `/?plan=<id>&title=<title>`. The Recorder keeps the plan id like the title prefill (sessionStorage), strips it from the address, and shows "Recording: <title> · planned meeting". When a meeting really starts (web, on-device native, cloud native) the link is saved in Dexie `kv` as `planLink:<meetingId>` and sent to the server; the SyncProvider re-sends pending links on start, when back online and on resume (gives up after 30 tries). A failed link never blocks recording. A "Next up" card on the Record screen (online, flag on) offers a plan starting from 15 minutes ago to 30 minutes ahead and starts recording in one tap.
- **UI:** `/plan` page (`?id=`, `?new=1`, `?seriesId=`) with title, date, time, length chips, time zone line, venue, call link, attendees (PersonPicker, designation shown, free text works), agenda, series select with "New series..." and cadence chips. Actions: Save, Record now, Join call (http/https only, system browser in the app), Add to calendar (.ics through the share sheet or a download), Share invite (text), Cancel meeting, Restore, Delete, Plan next in series. Meetings page has an "Upcoming" section (next 14 days) with "Plan a meeting" and a Record shortcut per row. The meeting page shows a "Planned meeting" card above the tabs. `/plan` is a static shell in the service worker; the Android back button treats it like a meeting page.
- **AI minutes:** when a plan is linked, the process route adds the attendees (name and designation) and the agenda to the system prompt with an instruction to follow agenda order and list attendees. No plan, no change.
- **Offline:** planning pages are online-only with the usual notice; recording from a plan works offline (title prefilled, link queued).
- **Tests:** `tests/planning.test.ts` (next date incl. DST and monthly edge cases, form mapping, validation, invite text, AI block, upcoming and next-up selection, plan ICS); flag and SW routing tests updated.

## Deviations

- `buildIcs` gained optional `attendees` and `location` (existing callers unchanged).
- The Record button on the Next up card prefills and starts recording at once (if the start gate allows it).
- The one-time "Show bookings as planned meetings" import button in /schedule was skipped (not cheap enough); old bookings stay in the Schedule Upcoming list.
- The series name on the meeting page's plan card links to the plan page (there is no series page).

## Not done / later

- Agenda carry-over of unfinished tasks (Phase 17), reference files (Phase 14), common free slots and invites (Phase 15).
- Editing a series' default cadence from the UI (the API supports `PATCH /api/series/[id]`).
- No offline cache of plans.
