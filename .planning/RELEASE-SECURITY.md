# Release security audit (v1.0.0-rc1, main @ 3f0e22f)

Scope: 63 route handlers under `src/app/api/**/route.ts`, 0 server actions (no `"use server"` in `src/`), server pages (`/admin`, `/book/**`), secrets handling, uploads, AI routes.
Method: read every handler and the DB helpers they call. No `.env` read, no database touched, nothing pushed, tag not moved.

Result: no CRITICAL or HIGH findings. Nothing was fixed, so there are no code changes and no `release-fixes` branch.

## Findings

| Severity | Route or file | Issue | Status |
|---|---|---|---|
| MEDIUM | `src/lib/auth.ts:15` (NextAuth credentials `authorize`) | No rate limit or lockout on password sign-in. bcrypt cost 10 only. Online guessing is not throttled. | fixed |
| MEDIUM | `src/app/api/meetings/[id]/process/route.ts:175` (`PROMPTS[template]` in `src/lib/minutesPrompts.ts`) | MOM/Report prompt says speaker names are untrusted (`UNTRUSTED_LABELS_NOTE`) but never says the transcript itself is data. Other participants' speech can steer minutes. Impact is the caller's own document only. No tools, no cross-user data. | fixed |
| MEDIUM | `src/app/api/meetings/[id]/action-items/extract/route.ts` via `src/lib/actionItems.ts:33` | Extraction prompt has no "transcript is data, never instructions" statement. Same self-only impact. Labels are sanitised by `aiSpeakerLabel`. | fixed |
| MEDIUM | `src/app/api/book/[handle]/[slug]/route.ts` | Public booking sends a confirmation email to any guest address. Limits: 10 per IP per hour, 3 future bookings per guest per host, honeypot. The limiter is in-memory per serverless instance, so it is best effort. Third-party email nuisance, not data exposure. | open |
| LOW | `src/lib/auth.ts:19-21`, `src/app/api/auth/register/route.ts:28` | Account enumeration: login says "No account found" vs "Incorrect password"; register returns 409 for an existing email. | open |
| LOW | `src/app/api/auth/register/route.ts` | No rate limit on sign-up. No max password length (bcrypt uses the first 72 bytes; body is capped by the platform). | fixed |
| LOW | `src/app/api/book/[handle]/[slug]/slots/route.ts:10` | Public slots endpoint has no rate limit (it does cap the range at 45 days). Read-only DB load. | open |
| LOW | `next.config.ts` `headers()` | Only COOP/COEP set. No CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` or `Referrer-Policy`. Admin and app pages can be framed. | open |
| LOW | `src/app/api/agenda/polish/route.ts`, `src/lib/followUpAgenda.ts:93` | Polish prompt has no untrusted-data label. Input is the caller's own draft, output goes back to them. | open |
| LOW | `src/lib/auth.ts` session config | JWT sessions with the NextAuth default 30-day life and no revocation. A JWT stays valid after account deletion. Cookie flags are NextAuth defaults (httpOnly, sameSite=lax, `__Secure-` prefix when `NEXTAUTH_URL` is https). Confirm the production `NEXTAUTH_URL` is https. | open |
| LOW | `src/app/api/plans/[id]/link/route.ts` | A not-yet-synced meeting id is accepted by design (documented). A user could pre-claim an id that is not theirs yet, but ids are 16-40 char random strings, so it is impractical. Attendee `stakeholderId` is stored unchecked, but nothing resolves it across users. | open (accepted by design) |
| INFO | public routes `/api/flags`, `/api/health`, `/api/app/latest`, `/api/client-errors`, `/api/book/*` | Intentionally public and confirmed to expose nothing sensitive. `/api/client-errors` scrubs, caps (40 KB) and rate-limits (30/min/IP). | ok |

## Verified OK (by area)

1. User data isolation. Every non-public handler calls `getUserId()` on every exported method (checked by counting methods against auth calls). Every Prisma read and write is scoped by `userId`, `hostUserId` or an owner check, using `findFirst`/`updateMany` with the owner in `where`. Where an `update({ where: { id } })` follows, it comes after an owner-scoped lookup in the same handler:
   - meetings (list, get, patch, delete, speakers, summary, ask, generate, process, extract, action-items, plan, follow-up)
   - plans, link, calendar, ics, invite, references (list, create, delete, summarize), carried-tasks, follow-up
   - series (all routes), stakeholders (all routes), action-items (all routes), schedule settings, bookings, agenda-links
   - Cross-user references are checked: `followUpFromMeetingId` (own meeting only), `ownerStakeholderId` (own live people only), `seriesId` (`ownsSeries`), event types (owned set).
   - Account deletion takes the user from the session only.
2. Free/busy (`/api/freebusy`). Signed in, 30 requests per minute per user, up to 10 emails, 14-day range. Only users with `shareFreeBusy: true` other than the caller are returned. Everyone else gets an identical `{ status: "unknown" }`. Only merged start/end intervals and working hours are returned, never titles. `/api/calendar/mine` returns titles, but only the caller's own.
3. Admin. `/api/admin/{stats,errors,flags}` and `/admin` require `isAdminAuthed()` (HMAC-signed, expiring cookie, `timingSafeEqual`). Login uses scrypt with `timingSafeEqual`, 5 failures per 15 minutes per IP, a constant ~1 s delay, and a cookie that is httpOnly, secure and sameSite=strict.
4. Public booking. Handle and slug are looked up server side. Responses never include the host's email (the ICS uses `noreply@transcriber.invalid`). Cancel, ics and the confirmed page all need the 24-byte random `cancelToken`, compared with `timingSafeEqual`. Failed cancels are rate limited. Input caps are in place (name 100, note 1000, email 200, agenda from the host's own draft only). The booking runs in a transaction under an advisory lock. Emails are plain text. ICS values are escaped.
5. Auth. The server enforces the sign-up domain (`isAllowedEmailDomain`, exactly one `@`, gmail.com or jainuniversity.ac.in) and the password rule (8+ characters, a letter, a number) in `/api/auth/register`. Login never creates accounts.
6. Secrets. No `process.env` in any `"use client"` file and no `NEXT_PUBLIC_` variables. No route returns a secret (Deepgram route mints a 120 s token only; email status is a boolean). `.env` and `.env*.local` are in `.gitignore`. `*.jks`, `*.keystore` and `keystore.properties` are in `android/.gitignore`, and `git check-ignore` confirms them. `git log --all --name-only` shows only `.env.example` for `.env` / `.jks` / `keystore` patterns, and its values are empty.
7. Uploads. Prework references: 4 MB cap (Content-Length precheck and real size check), 10 per meeting (re-checked after insert), extension allow-list, magic-byte sniff, PDF page cap and timeout, docx zip-bomb guard (10 MB inflated cap), text only stored. Stakeholder import: max 200 rows. Transcript patches: Zod caps (60,000 parts, 5,000 characters each).
8. AI routes. Authenticated and rate limited (30/hour/user, best effort per instance), with a model enum and input caps. Untrusted-data labelling is present on ask, generate (combined), speaker-names and prework summarize. Gaps are listed above (process, extract, polish).
