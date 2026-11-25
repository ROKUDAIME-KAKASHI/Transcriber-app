# Phase 11: Duplicate guards + change history - Summary

**Status:** code complete on branch `step-1-dedupe-history`. Migration `2_history` is created but NOT applied anywhere (no database was touched).

## What was built

| Req | Result |
|-----|--------|
| DUP-01 | Tasks: extraction review tags rows "Already saved" (start unchecked) and "Possible duplicate" (Jaccard >= 0.8). Save API skips exact normalized duplicates within the meeting and within the request, returns `{items, saved, skipped}`; toast "Saved N tasks · M duplicates skipped". Tracker shows a "Possible duplicate" chip that scrolls to the other task, plus a Delete task button (two-step). Meetings list tags "Possible duplicate" (same normalized title, start within 10 min, length within 20%). Host Upcoming list tags "Same guest booked twice" (same email, overlapping or same day in the host zone). All tag-only; nothing is auto-deleted. |
| DUP-02 | Long-phrase fallback split at 5000 chars (`splitLongPhrases`), re-extract duplicates handled above, sign-out failure toast, agenda polish locks the textarea and offers "Undo polish", agenda sheet traps Tab (focus return already existed). |
| HIST-01 | `ActionItemEvent` + `ActionItem.deletedAt` (migration `2_history`). Events on save (created), PATCH (one per really changed field) and DELETE (soft delete, then a deleted event). Tracker expanded row shows "Status: Not started → In progress · 25 Nov, 3:10 pm", newest first, 5 then "Show more" up to 20. History writes never fail the request. |

## Graceful degradation (migration not applied)

- `withLive()` retries any task query without the `deletedAt` filter on P2022.
- DELETE falls back to a real delete when `deletedAt` is missing.
- `recordEvents()` swallows P2021/P2022 silently; other errors are logged without values.
- History endpoint returns `{events: null}` and the tracker hides the History section.

## Files

Created: `src/lib/dedupe.ts`, `src/lib/taskHistory.ts`, `src/lib/actionItemHistory.ts`, `src/app/api/action-items/[itemId]/history/route.ts`, `prisma/migrations/2_history/migration.sql`, `tests/dedupe.test.ts`.
Modified: `prisma/schema.prisma`, `src/lib/actionItems.ts`, both action-item route groups, `ActionItems.tsx`, `TaskTracker.tsx`, `MeetingList.tsx`, `ScheduleSettings.tsx`, `FollowUpAgenda.tsx`, `useSignOut.ts`, planning docs.

## Deviations / limits

- The "agendas saved twice" part of success criterion 1 is not deduplicated: `AgendaDraft` rows are still created on each "Schedule follow-up". Bookings are tag-only, as scoped. Candidate for a later step.
- Meeting edit history (titles) was not added; HIST-01 is implemented for tasks only, as scoped.
- The migration SQL was generated offline with `prisma migrate diff` from the old to the new schema file; never run.

## Verification

`npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit`, `npm test` (346 pass, 10 new), `npm run build` (CI placeholder env) and `npm run check-build` all pass. UI behaviour was not exercised in a browser; see 11-HUMAN-UAT.md.
