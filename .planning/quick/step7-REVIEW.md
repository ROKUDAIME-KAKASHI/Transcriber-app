# Step 7 (Phase 17 follow-up) review

Scope: `git diff main..step-7-followup`. Checks: tsc clean, 467 tests pass, build ok.

## AuthZ (OK)
All four routes require `getUserId()`, then flag and planning-paused checks, then look up every row with `userId` in the where clause (plan, meeting, series, source tasks, earlier series plans). A foreign plan or meeting id gives 404. Attendee and People ids are copied from the requester's own plan. The heading lookup in carried-tasks (title and createdAt within 2 days) has `userId` in its where clause, so it can only match the requester's meetings. Heading text is user-editable but is only used as a filter value.

## Fixed in this branch
- HIGH (idempotency, non-series): two taps or two devices could create twin plans, because only series have a unique index. Now after create the oldest matching plan (same user, title, start, no series) wins and the newer twin is soft-deleted.
- MEDIUM (idempotency, series): a concurrent request hitting the unique index returned 409 instead of the plan the other request created. Now re-finds and reuses it; 409 stays for a cancelled-meeting clash.
- MEDIUM (user edits): the agenda fill was a blind `update`, so an edit made between read and write was lost. Now `updateMany` conditioned on the agenda still being what was merged into.
- MEDIUM (8000-char cap): points that did not fit were silently dropped. A note "(N more unfinished tasks not shown. See Meetings > Action items.)" is now added (test added).

## Verified OK
- Merge: duplicates skipped by normalised key, owners and tasks whitespace-collapsed (no newlines), DONE and soft-deleted tasks excluded (`status != DONE` plus `withLive`), cap respected, re-run changes nothing.
- `buildAgendaDraft` output: refactor only moves the point-building into `agendaPoints`; existing agenda tests unchanged and passing.
- Flag off or tables missing: routes return 503 (`followUpPaused`, P2021/P2022 mapping); the button returns null when the flag is off, and the panel and "Follow-up of" line swallow errors.

## Remaining (low, not fixed)
- Attendee `createMany` runs after plan create; if it fails, a retry finds the plan without attendees and does not re-add them.
- `carriedHeading` truncates titles to 120 chars and collapses whitespace, so for such titles the non-series heading lookup (exact `title` match) finds nothing.
- Meeting follow-up for a recording with no plan trusts the client timezone/`today` (validated format only); harmless.

## ESLint
There is no `eslint.config.*` or `.eslintrc*`, no `eslint` dependency and no `lint` script in `package.json`. `npx eslint` therefore downloads a fresh ESLint, which finds no config and lints nothing. Lint is effectively not set up (not disabled by an ignore list). `tsc --noEmit` is the only static check.
