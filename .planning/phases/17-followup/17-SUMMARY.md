# Phase 17: Follow-up - Summary

**Status:** Complete in code, needs UAT. **No migration** (no schema change).
**Requirements:** FUP-01, FUP-02
**Flag:** `followUpPlanning` (default on), Admin > Feature switches > "Plan next meeting". It builds on `plannedMeetings`; the carried-tasks panel also needs `taskTracker`. Flag off: no button, no panel, no "Follow-up of" line, and the APIs answer 503 "paused"; everything else behaves as before.

## What was built

- **"Plan next meeting" button** (`PlanNextButton`) in four places: Meetings > Action items (next to "Prepare follow-up agenda"), the linked-plan card on a recorded meeting, the plan page of a RECORDED plan (replaces "Plan next in series" there), and the follow-up agenda sheet next to "Schedule follow-up". It creates or finds the next meeting, shows "Next meeting planned · N tasks carried over" and opens `/plan?id=<new>` where Find a time, attendees, agenda and invites work as usual. Disabled offline.
- **`POST /api/plans/[id]/follow-up`** (recorded plan) and **`POST /api/meetings/[id]/follow-up`** (a recording; uses its plan when it has one). Owner-scoped, idempotent: asking twice returns the same plan and the same agenda (`existing: true`).
  - In a series: if a planned meeting already exists after the source (auto-planned by keep-ahead, or planned by hand) it is reused and only its agenda is filled; otherwise the next date by cadence from the latest series meeting.
  - No series: same weekday and time one week later in the plan's zone, moved on by whole weeks until it is in the future. A recording without a plan uses the caller's browser zone and its start time. Not in a series: "Make this a series" appears on the new plan page (sets the Series section to a new series with the title filled in).
  - Copies title, length, venue, call link and attendees (with People ids). A cancelled meeting at the target time in a series gives a 409 message, as "Plan next in series" does.
  - Agenda: heading "Carried over from <title> (<date>)", the unfinished non-deleted tasks in `buildAgendaDraft` order (blocked, overdue, in progress, not started; owners resolved from People), then "Any new discussion topics". An existing agenda keeps its text; new points go under the heading, lines already present are skipped (ignoring numbering and case). In a series the tasks of every earlier recorded meeting are included.
  - The carried count lives in the agenda text only; the UI counts the numbered lines under the heading ("N tasks carried over").
- **Carried-over tasks panel** (`CarriedTasksPanel`, plan page of a PLANNED plan): open tasks of the source meeting(s), live from `/api/action-items?status=open`, with status chips, an Overdue chip and a status select (PATCH to the tracker API). Done ones drop off. `GET /api/plans/[id]/carried-tasks` finds the source meetings: earlier recorded meetings of the series, plus the meeting named in the heading (same title, within two days of the date).
- **"Follow-up of <previous meeting>"** link on the linked-plan card of a recorded meeting, from series order (`GET /api/meetings/[id]/follow-up`). Without a series nothing is stored and nothing is shown.
- **Pure helpers** `src/lib/followUp.ts` (merge without duplicates, date choice, heading parse, carried count, previous recorded) and `agendaPoints` extracted from `buildAgendaDraft` (its output is unchanged). Server glue in `src/lib/followUpDb.ts`.
- **Tests:** `tests/followUp.test.ts` (ordering, merge idempotence and de-duplication, size cap, counting, no-series and series date choice incl. reuse, monthly, previous recorded).

## Safe before the migrations and with the flag off

Routes catch missing planning tables (P2021/P2022) and return the usual 503 "Planning needs a database update", shown as a toast; the panel and "Follow-up of" line render nothing on any error. The owner link column is optional (`withOwnerLink`).

## Deviations and limits

- No schema change, so which tasks were carried is not stored: a non-series follow-up finds its source meeting again by the heading's title and date (tolerance two days). Editing that heading line in the agenda detaches the panel; the series route does not depend on it.
- "Linked to the previous one as part of the same series" (roadmap criterion 3) holds when the source is in a series. Without one the new meeting is standalone, per the brief; "Make this a series" starts one from the new meeting (the source is not added to it).
- Tasks of a non-recorded plan cannot be carried (the button is for RECORDED plans and recordings).
- The title is the source title unchanged; "Overdue" uses the caller's local day.
