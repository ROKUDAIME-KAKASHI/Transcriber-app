# Phase 15: Calendar blocking - Summary

**Status:** Complete in code, needs UAT and `6_calendar` applied.
**Requirements:** CAL-01, CAL-02, CAL-03
**Flag:** `calendar` (default on), Admin > Feature switches > "Calendar". It builds on `plannedMeetings` (and `scheduling` for the booking page).

## What was built

- **Migration** `prisma/migrations/6_calendar/migration.sql`, generated offline with `prisma migrate diff` from main's schema. Additive: `User.shareFreeBusy` (default false), `MeetingSeries.keepAhead` (default 0), `PlannedMeeting.icsSequence` (default 0), `PlannedAttendee.invitedAt` (NULL), and unique `PlannedMeeting(seriesId, startAt)` (NULL series ids don't clash). A no-op safety step nudges exact duplicate starts in one series by 1 ms before the index is built.
- **Own busy time everywhere** (`src/lib/calendarDb.ts`): `busyIntervals(userId, from, to)` returns CONFIRMED bookings plus PLANNED plans (not deleted, cancelled or recorded) with their lengths. The public slot list and the booking re-validation add the host's planned meetings as busy time (buffer applies as for bookings). The plan lookup runs outside the booking transaction so a missing table can't poison it. Flag off or any error: no extra blocks, booking behaves as before.
- **Conflict warning** on the plan page: "You already have Weekly review at 3:00 pm", non-blocking, ignores the plan being edited.
- **Free/busy sharing:** Profile > Calendar switch "Let people who add me see when I'm busy" (off by default, `PUT /api/calendar/prefs`). `GET /api/freebusy?emails=&from=&to=` (signed in, at most 10 emails and 14 days, 30 requests a minute per user) returns merged busy start/end plus working hours in the person's zone for opted-in users, and an identical `{status:"unknown"}` for non-users, non-sharers and the caller, so account existence is never revealed. No titles or details.
- **Find a time** (`FindATime`, pure `findCommonSlots` in `src/lib/calendar.ts`): your own busy time and hours, plus every attendee email that shares, 15 minute steps on the UTC grid, DST safe (each working range is converted through the zone at both ends), up to 6 suggestions in the next 14 days (two a day first, none overlapping). People who can't be read are listed under "Availability unknown", never guessed. Tapping a suggestion fills date and time.
- **Series auto-planning:** `MeetingSeries.keepAhead` with a Series settings sheet (cadence chips, which were missing, and 0/2/4/8) reachable from the Series panel. `ensureAhead` runs when Upcoming (`GET /api/plans`) or a series plan loads and when the setting is saved: it creates only the missing future occurrences from the latest meeting using the existing cadence logic, copies title, length, place, link and attendees, skips any time already held by a planned, cancelled or deleted plan (so a cancelled single occurrence stays cancelled and the series reaches one further), and treats a unique-key clash (P2002) as "already exists". Throttled per user.
- **Invites:** plan .ics is `METHOD:REQUEST` with `ORGANIZER` (the user's email), `ATTENDEE;RSVP=TRUE`, a stable `UID` and `SEQUENCE`; a cancelled plan gives `METHOD:CANCEL`. With nobody to name it stays `PUBLISH`. `icsSequence` is bumped when title, time, length, venue, link or status change. `POST /api/plans/[id]/invite` (mode invite or cancel) emails each attendee that has an address through the existing Resend sender (subject "Invitation: Title · Mon 12 Jan, 9:30 am", .ics attached, Reply-To the organizer), at most 30 recipients, 3 sends per plan and 10 per user an hour, and records `invitedAt`. The button reads Send invites, then Send update, then Send cancellation (after cancelling a plan with invited people). Email not configured: the button becomes "Share invite file" with "Email isn't set up. Share the invite file instead." and uses the existing share path. Saving a plan keeps who was already invited.
- **Tests:** `tests/calendar.test.ts` (interval merge, working hours across DST, common slots incl. spring-forward week and different zones, conflicts, email list and range validation, `missingOccurrences` incl. cancelled occurrence, idempotency, monthly, DST, invite method, sequence bump, subject, labels, ICS REQUEST/CANCEL).

## Safe before the migration

Every `prisma.user` query already used an explicit `select`, and no existing select (`PLAN_SELECT`, `SERIES_SELECT`, ...) was extended, so nothing reads the new columns until the new routes do. New routes answer 503 "Calendar needs a database update", the UI hides itself (a probe of `/api/calendar/prefs`), and the .ics is the old file.

## Deviations and limits

- "Blocked for everyone": the meeting blocks the organizer's own calendar and the public booking page, and other Minutely users see it as busy time only if they opted in and are on a shared meeting of their own. Minutely does not create the meeting in another user's account; they get the email invite (.ics). Real two-way calendar sync is not built.
- Google and Outlook calendar sync remains future work.
- A shared user who has no saved time zone is treated as having the organizer's working hours.
- Invites email sequentially (about two a second, Resend's limit), so 30 recipients take roughly 16 seconds.
- The rate limits are per server instance, like the other limiters.
- Auto-planned meetings don't send invites by themselves; use Send invites on each.

## Not done / later

- Reading Google or Outlook busy time, RSVP replies back into Minutely, per-occurrence edits that re-link to the series.
