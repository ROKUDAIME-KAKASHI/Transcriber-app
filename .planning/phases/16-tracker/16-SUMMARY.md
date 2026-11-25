# Phase 16: Tracker upgrades - Summary

**Status:** Complete in code, needs UAT and `7_tracker` applied.
**Requirements:** TRK-01, TRK-02, TRK-03
**Flag:** `trackerPlus` (default on), Admin > Feature switches > "Tracker upgrades". It builds on `taskTracker`; series progress also needs `plannedMeetings`, owner pickers need `stakeholders`.

## What was built

- **Migration** `prisma/migrations/7_tracker/migration.sql`, generated offline with `prisma migrate diff` from main's schema. One nullable column: `ActionItem.ownerStakeholderId`. No foreign key (a deleted person keeps the owner text), no index.
- **Owners are People (TRK-01).** Picking a person in the tracker or in the extraction review sets the owner name and `ownerStakeholderId`; typing free text clears the id. `PersonPicker.onCommit` now also passes the person's id (and the id of a person added on the spot). The task list and the per-meeting list resolve the id on read, so a rename in People shows the new name; a deleted person leaves the stored text. The Owner filter groups by person id when present, else by text (`p:<id>` values). The owner field has a tooltip with the designation, and the expanded task shows "Owner: Name · Designation · from People". The PATCH route also clears the link when `owner` is edited without an id, so an older cached page cannot leave a stale link.
- **Link owners to People.** A notice on Tasks (only after 7_tracker, when the directory is loaded) lists unlinked owners that match a person by exact case-insensitive name, with task counts, and links them after "Confirm and link". Names shared by two people are never guessed. `POST /api/action-items/link-owners` recomputes the matches on the server, owner-scoped; the body can only narrow the people. Owner text is not changed.
- **Timeline (TRK-02).** Tasks has a List / Timeline toggle (`?view=timeline`). Sections: Overdue, Today, This week (to Sunday), Next week, Later, No date, each a compact list with owner chip, meeting, series, status chip and due date; done tasks are hidden unless "Show done" (then a Done section). Tapping a title opens it in the List view. Weeks run Monday to Sunday in the user's local day.
- **Overdue alerts (no email).** `GET /api/action-items/summary?today=` returns `{overdue, dueToday, open}`. A Tasks tab badge (aria-label "3 overdue tasks"), a once-a-day toast "3 tasks are overdue · View" linking to `/tasks?view=timeline`, and an "N tasks are overdue · View" line under the Record hero when idle. One shared client cache (5 minutes, online only, refreshed on return to the app and after a task edit). Profile > Preferences > "Remind me about overdue tasks" (default on, `localStorage`, this device) turns all three off. `Toast` gained an optional link action (stays 6 s).
- **Series progress (TRK-03).** `GET /api/series/[id]/progress?today=` aggregates tasks of every meeting linked to a plan in the series: counts by status, overdue and a per-meeting done/total list. Shown on the plan page as "Series progress" ("Weekly review · 12 done · 3 in progress · 2 overdue", a stacked bar with a text alternative, a "By meeting" list, "View tasks"). Task rows and the timeline carry the series name; a "Series" filter on Tasks (`?series=`) and a series chip that sets it.
- **Soft-deleted tasks** are excluded everywhere through `withLive`; everything is scoped by `userId`.
- **Tests:** `tests/trackerPlus.test.ts` (timeline bucketing incl. Sunday edge, grouping, summary, parse, wording, daily toast rule, series aggregation, owner options, owner and series filters, owner matching).

## Safe before the migration and with the flag off

Every task query goes through `withOwnerLink`: flag off runs the old query; flag on tries the new column and, on a missing column (P2021/P2022), runs the old query. The list, per-meeting list, PATCH and save routes then return and write exactly the old fields. Without the column nothing resolves owners or adds series chips and the notice stays hidden. The new routes answer 503 when paused or not migrated and the UI hides itself.

## Deviations and limits

- The Timeline ignores the status chips (it has its own "Show done"); owner, meeting and series filters apply to both views.
- A free-text owner whose name equals a linked person's name is a separate entry in the Owner filter until "Link owners to People" is run.
- The overdue reminder switch is per device; the daily toast is remembered per device.
- Series progress counts tasks from recorded meetings only (plans with no recording have no tasks).
- No schema change for the reminder switch, per the brief.
