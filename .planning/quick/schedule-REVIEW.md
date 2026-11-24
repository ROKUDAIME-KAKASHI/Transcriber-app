---
phase: quick-schedule
depth: deep
files_reviewed: 25
findings:
  critical: 0
  warning: 5
  info: 4
status: issues_found
---

# Scheduling feature review (b765a9b..20a4fa4)

## Sign-in (priority 1): OK
- `src/lib/auth.ts` authorize selects `{id,email,password}` and register selects `{id}` on find and create. Neither touches `bookingSlug`/`timeZone`, so both work before and after `prisma db push`.
- Every other `prisma.user` call: `adminData.ts` (explicit select), settings GET/PUT, agenda-links, booking after() email lookup. All use explicit `select`, and none is in the auth path. Pre-push they fail with P2021/P2022, which `isSchedulingMissing` maps to 503.
- No `include: { user: true }` anywhere.

## Verified fine
- cancel and ics: token is required, compared with `timingSafeEqual` (length checked first). Unknown id and bad token both return the same 404. Cancel has a failure limiter.
- The host's real email is never sent to guests. The ics organizer is a placeholder address, and the emails to the guest use only the handle.
- Booking is serialised with `pg_advisory_xact_lock` inside `$transaction`, which is safe on pooled Neon connections. Availability is re-validated in the transaction: past, min notice, max days, duration from the event row (not the client), and overlap plus buffer.
- Slots endpoint: range capped at 45 days, work bounded by maxDaysAhead.
- DST: `zonedToUtc` skips non-existent wall times and picks the earlier instant for repeated ones.
- Agenda: `findAgendaFor` restricts to the host's own drafts. Only the text is exposed. Text is capped at 8000 chars. `followUpFromMeetingId` is ownership-checked.
- Rendering is by React with no `dangerouslySetInnerHTML`.
- Resend: JSON body, so no header injection.
- Settings: owner-scoped, reserved handles, P2002 mapped to 409.
- SW: `/book/**` is pass-through, and `/schedule` is a shell. Recorder `?title=` is stripped, length-capped and rendered as text.

## Warnings (fixed)
- WR-01 `src/lib/scheduling.ts` icsEscape: a lone `\r` in guest note, agenda or name survived, so a CR-only line break could inject calendar properties in lenient parsers. Also, the CN param was unquoted, so `:` in a name broke parsing. Fixed: normalise `\r\n|\r|\n`, strip control chars, and quote the CN via `icsParam`. Test added.
- WR-02 `src/app/api/book/[handle]/[slug]/route.ts`: guest name may contain control chars/newlines, which end up in email subjects and text. Fixed: control chars are collapsed to spaces before validation.
- WR-03 `src/app/book/layout.tsx`: `/book/confirmed/<id>?t=<secret>` could leak the token via the Referer header (e.g. the Google Calendar link). Fixed with `referrer: "no-referrer"`.
- WR-04 `src/app/api/schedule/agenda-links/route.ts`: AgendaDraft ids were Prisma cuid v1 (time-based, partly predictable). Fixed: 144-bit `randomBytes` id.
- WR-05 `src/app/api/book/[handle]/[slug]/route.ts`: the booking endpoint can be used to send emails containing guest-chosen text to any address (10 per IP per hour). Not fixed (needs a product decision). The mitigation is a per-host daily cap or a captcha.

## Info (not fixed)
- IN-01 The limiters are in-memory per serverless instance, so they are best-effort only. IP comes from the first `x-forwarded-for` entry (Vercel overwrites it).
- IN-02 The slots GET has no rate limit (each call is 2 cheap queries).
- IN-03 In settings PUT, the P2002 handling depends on `err.meta.target`. With a driver adapter, an event-slug collision could report "handle taken". It is already pre-checked for duplicates in the request, so it is only reachable in a race.
- IN-04 Handles can change, so an old link goes dead. Acceptable.
