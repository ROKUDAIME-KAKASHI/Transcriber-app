# Step 6 (tracker) review

Scope: `git diff main..step-6-tracker`. Status: no critical issues. Two fixes applied, three notes.

## Checked and OK
- **Pre-migration fallback.** `withOwnerLink` wraps list, meeting list and save. On P2022 for `ownerStakeholderId`, `withLive` first retries without `deletedAt` (it fails again), then `withOwnerLink` re-runs the whole query without the column, with `withLive` applied again. No 500s. PATCH, save and the list read and write the old fields. link-owners answers 503 (`isMissing`) and summary answers 503, so the UI hides itself.
- **AuthZ.** link-owners recomputes matches server-side. Tasks and people are both filtered by `userId`, and the update is `userId` + `ownerStakeholderId: null`. The body can only narrow the people. Series progress checks the series, plans, meetings and tasks against `userId`. Summary is scoped by `userId`. On PATCH and save, a client-supplied stakeholder id must be one of the user's live people (`livePerson` / `valid` set). Otherwise it is ignored, and on PATCH it clears the link only when the owner text changed.
- **Timeline and overdue rule.** Bucketing compares date strings (`dueDay` vs the local `today`). Weeks run Monday to Sunday. The summary route's `dueDate < today` and `status != DONE` matches `isOverdue` and the timeline's "overdue" section. Due dates are UTC midnight and `today` is parsed as UTC midnight, so the comparison is consistent.
- **Toast.** The `action` parameter is optional and existing calls are unchanged. The toast container is `pointer-events-none` but the toast itself is `pointer-events-auto`, so the link is tappable.
- **AppShell badge.** It is absolutely positioned inside a `relative` span in the bottom tab, and `ml-auto` in the sidebar, so the tab layout is unchanged at 320 px. Polling is bounded: one shared cache, 5 minute TTL, a single in-flight request, and a back-off after failures. There is no timer. It only refreshes on mount, on return to visible, and after a task edit. It is silent when the flag is off, when offline, and on non-OK responses.
- **Migration 7_tracker.** Regenerated from main's schema with `prisma migrate diff`, and it is identical (one nullable column, no default, no index). Additive.

## Fixed
- **WR-01 (medium): overdue fetch could run during a recording.** `OverdueLine` unmounts while recording, but the shared hook in AppShell still fetched on a visibility change. `refresh()` in `src/lib/overdueClient.ts` now checks `isRecordingActive()` (web flag or the cheap native probe) and skips the fetch when a recording is running. If the probe fails it assumes recording.
- **WR-02 (low): stale response across accounts.** `reset()` cleared state, but a request still in flight for the previous user could overwrite the new user's summary. The response is now dropped when `cachedFor` changed.

## Notes, not changed
- IN-01: after a skipped fetch (recording), the count catches up only on the next resume or task edit, not right when recording stops. This is acceptable because the data is non-critical.
- IN-02: the summary route runs 3 count queries for each refresh, at most once per 5 minutes per device. Fine.
- IN-03: when the `trackerPlus` flag is on but the column is missing, each list request pays one failed query before the fallback. Fine until the migration is applied.

Verification: `npx prisma validate` OK, `npx tsc --noEmit` clean, `npm test` 445/445, `npm run build` OK (CI placeholder env).
