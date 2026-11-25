# Week review (5e33115..HEAD, excluding scheduling core reviewed in f40aff2)

Baseline: tsc, 318 tests, build all green before and after fixes. Java unchanged, gradle not run.

## Verified OK
- Admin: scrypt + HMAC cookie (httpOnly, secure, strict), timing-safe compare, expiry; login limiter + 1 s pad; /api/admin/stats and /admin page both check isAdminAuthed; no transcript/document data selected.
- Every action-item, task, agenda, schedule route is userId-scoped (updateMany/deleteMany with userId; meeting ownership checked); P2021/P2022 -> 503.
- openExternal accepts only http/https; no intent:// or file://.
- SW: /admin, /book, /downloads, /api pass; /, /meetings, /meeting, /tasks, /schedule, /profile are shells.
- Rename: storage keys, Dexie name, cookies, channel IDs, applicationId (in.transcriber.app), API paths unchanged (only labels/strings).
- Booking simplification: referrer no-referrer, honeypot, token-based cancel/ics unchanged; agenda lookup still host-scoped.
- Due dates: stored as UTC midnight, compared by UTC day string vs local today; consistent.

## Findings
- MEDIUM (fixed) AI cost: extract (up to 8 chunks x 4k tokens) and agenda polish had no per-user call cap. Added a best-effort 30/hour limiter per user (429).
- MEDIUM (fixed) Admin "Recent meetings" exposed every user's meeting titles, contradicting the "aggregates only" comment. Titles removed from query and table.
- MEDIUM (fixed) TaskTracker optimistic rollback could undo a newer successful edit of the same field when an earlier PATCH failed late. Rollback now only restores a field if it still holds the failed edit's value.
- LOW (fixed in Phase 11) Extract body caps phrase text at 5000 chars; one longer phrase makes the fallback client transcript 400.
- LOW (fixed in Phase 11) Re-extracting and saving can create duplicate tasks; no per-meeting cap or dedupe on save.
- LOW (fixed in Phase 11: sign-out toast, agenda polish lock + Undo, focus trap) useSignOut swallowed failure silently; agenda polish overwrote edits; follow-up sheet had no focus trap. Still open: admin login limiter is per-instance memory.
- INFO Transcriber.apk and Minutely.apk are identical 3.6 MB blobs committed twice.
