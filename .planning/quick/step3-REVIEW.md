# Step 3 (planned meetings) review

Scope: main..step-3-planned-meetings. Depth: standard/deep on the priority areas.

## Fixed
- WR-01 (medium) `src/lib/planning.ts` `planPromptBlock` / `attendeeLine`: attendee names and designations (guest names come from the public booking form) went into the AI system prompt with newlines intact, and the agenda was not marked as data. Names/designations are now collapsed to one line and capped at 100 chars, and the agenda/attendee lines are labelled as user-supplied data, not instructions.

## Verified OK
- Recording: `linkStartedMeeting` runs after start succeeds, is sync-safe (peek/flag read inside, async work in a detached IIFE with try/catch around kv and fetch), never awaited, never throws into start paths. Offline/nativeLocal: link stored in kv first, retried at most 30 times (flush on start, online, visibility). Flag off: nothing sent. Missing tables: server 503 -> retry, bounded.
- Booking: `createPlanForBooking` / `cancelPlanForBooking` catch everything, flag-gated, idempotent per bookingId. Cancel only touches the plan with that bookingId (host-owned by construction).
- AuthZ: link route checks plan ownership, rejects a meetingId that exists under another user; unseen ids accepted, but `/api/meetings/[id]/plan` and the process route both filter by requester userId, so a pre-linked foreign id exposes nothing. All plan/series/ics routes owner-scoped. callUrl validated http(s) in zod on save and by `isHttpUrl` on open.
- Migration `4_planned_meetings` is byte-identical to `prisma migrate diff` from main's schema; only CREATE TABLE/INDEX/ADD CONSTRAINT on new tables.
- Series: occurrences computed from the base (no drift), monthly n-th weekday with 5th falling back, spring-forward gap handled; "next" is idempotent for sequential calls.

## Remaining (not fixed, low)
- IN-01: Booking route awaits `createPlanForBooking` (about 3 small queries) before responding; could move into the existing `after()`.
- IN-02: Two concurrent `POST /series/[id]/next` calls can create duplicate plans (no unique key on seriesId+startAt). Low likelihood, single user.
- IN-03: A stale `plan` prefill in sessionStorage links the next recording started in that tab (same behaviour as the title prefill).

## Checks
prisma validate OK, tsc OK, npm test 387/387, npm run build OK (placeholder env).
