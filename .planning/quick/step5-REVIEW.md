# Step 5 (calendar) review

Scope: main..step-5-calendar. Checks: prisma validate, tsc, npm test (432 pass), build all OK.

## Verified OK
- 6_calendar: UPDATE shifts only rows with row_number > 1 inside (seriesId, startAt) groups; NULL seriesId filtered out in the subquery; rank 1 stays; empty table or no duplicates = no-op; valid Postgres (int * interval). Rest is additive and matches the schema diff. Residual (negligible): a shifted row could land on an existing +1 ms row.
- Freebusy: same `{status:"unknown"}` shape for non-user / non-sharer / caller, only opted-in users, no titles/ids, caps 10 emails / 14 days, 30 calls/min limiter counted on every call. Hours only for sharers.
- Booking: planned meetings (PLANNED, not deleted) of the host only, read outside the transaction, advisory lock untouched, missing table/flag off returns [] (old behaviour); buffer applied by isSlotAvailable.
- ensureAhead: max 8 (clamped), loop bounded at 200, cancelled/deleted starts are "taken", P2002 ignored, owner-scoped.
- ICS: METHOD REQUEST/CANCEL/PUBLISH choice sensible; SEQUENCE bumped on title/time/length/venue/link/status; text/CN/line folding escaped; subject strips control chars (Resend JSON API, no raw headers); Reply-To is organizer; recipients only from the plan's own attendees; max 30; flag off 503.

## Fixed
- HIGH: no daily cap on invite emails (10 sends/h x 30 = 300/h). Added 100 emails per user per rolling 24 h (counted per recipient), 429 on excess.
- MEDIUM: POST /api/plans returned 500 on the new unique (seriesId, startAt) clash; now 400 with a clear message.
- LOW: ORGANIZER mailto in .ics now stripped like ATTENDEE addresses.

## Left as warnings
- /api/freebusy lets any signed-in user query any opted-in email (not only people they plan with), even though the switch text says "people who add me". Restricting needs the draft attendees on the server; accepted trade-off, suggest a copy tweak.
- Shared path does 2 extra queries vs unknown path, so timing differs slightly (sharer existence is already disclosed by design).
- Unique index also covers soft-deleted plans, so a deleted plan's slot can't be reused in a series (returns the new 400/409).
- All limiters, including the new daily cap, are per server instance (serverless), so best-effort only.
