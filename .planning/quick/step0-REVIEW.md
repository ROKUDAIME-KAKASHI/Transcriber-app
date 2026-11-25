# Step 0 review (branch step-0-safety)

Depth: standard. Verified: prisma validate, tsc, npm test (336 pass), npm run build + check-build with dummy env.

## Verified OK
- `0_init` is byte-identical (ignoring CRLF) to `prisma migrate diff --from-empty --to-schema-datamodel <main schema> --script`. `1_safety` is byte-identical to the diff main schema -> branch schema: two CREATE TABLE and two CREATE INDEX, purely additive.
- Datasource uses `DATABASE_URL` (pooled) and `directUrl = DATABASE_URL_UNPOOLED`; docs now name them correctly.
- `/api/admin/flags` and `/api/admin/errors` require `isAdminAuthed()` (SameSite=strict cookie). `/api/flags` returns only the boolean registry.
- ErrorReporter: fetch failures are swallowed (no unhandledrejection, no recursion), per-page cap of 10 distinct reports, so offline cannot flood. ErrorBoundary only reports once and offers a manual Reload (no loop).
- CI: placeholders only, no secrets, `npm ci` with lockfile, Node 24, prisma generate has DB placeholders.
- Transcriber.apk redirect: next.config redirects run before static files; 307 to Minutely.apk, which carries the attachment headers. Old banners (b3cf396 used /downloads/Transcriber.apk) follow the redirect in browsers/DownloadManager.
- release-apk.mjs never prints keystore.properties or passwords (gradle stdio only).

## Findings and fixes
| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | High | `scheduling` off only hid the /book page; `/api/book/[handle]/[slug]` (create booking) and `.../slots` still worked, so the API stayed usable | FIXED: both return 503 "Booking is turned off". Decision: cancel and ics for existing bookings keep working (guests must still be able to cancel); host `/api/schedule/*` writes stay allowed |
| 2 | Medium | `nativeLocal` in Recorder depended on `offlineLockedRecording`; if the flag flipped (5 min refresh) during a native capture the UI would switch layout while the foreground service kept recording | FIXED: nativeLocal stays true while `nativeRec.isRecording/isStarting`. `start()` only consults the flag at start time, recovery paths untouched |
| 3 | Medium | Public client-errors stored emails in messages and unscrubbed stacks (query strings, tokens) | FIXED: `scrubMessage` strips emails; new `scrubStack` strips queries/emails/bearer tokens; content-length pre-check before reading the body; test added |
| 4 | Medium | release-apk: Ctrl+C or an exception after the version bump left build.gradle/appRelease.ts half-bumped | FIXED: SIGINT/uncaughtException restore the files until success |
| 5 | Medium | DB-MIGRATIONS had no read-only drift check before the baseline | FIXED: Step 0 section with `prisma migrate diff --from-url "$DATABASE_URL_UNPOOLED" --to-migrations prisma/migrations --script` (flags verified against `prisma migrate diff --help`; notes the shadow-database requirement and how to read the output). Not run |

## Open (not fixed, low)
- ClientError has no retention or row cap: an attacker can create up to 30 distinct rows per minute per IP (unique messages). Admin can clear the log. Suggest a cron/prune or a global row cap later.
- The limiter is per serverless instance and trusts the first x-forwarded-for entry (fine on Vercel, which sets it).
- Flag changes reach clients after up to 60 s (edge cache) plus 5 min (client refresh).
- CI uses Node 24; make sure it matches the Vercel project Node version (no `engines` field pins it).
- Reports are not suppressed while offline (they just fail silently); acceptable.
