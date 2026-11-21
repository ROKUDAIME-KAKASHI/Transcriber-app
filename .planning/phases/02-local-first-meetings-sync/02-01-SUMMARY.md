---
phase: 02-local-first-meetings-sync
plan: 01
subsystem: api
tags: [prisma, nextjs, sync, idempotency, last-writer-wins]
requires: []
provides:
  - Idempotent POST /api/meetings with client ids
  - GET /api/meetings?since= pull cursor with ids and serverTime
  - PATCH title last-writer-wins, speakerNames, engine
  - PATCH /api/meetings/:id/speakers relabel endpoint
  - GET /api/health reachability probe
  - meetingSelect helpers (explicit selects, P2022 legacy fallback)
affects: [02-02, 02-03, 02-04, 02-05, phase-04]
tech-stack:
  added: []
  patterns: ["explicit Prisma selects with P2022 legacy fallback", "create-then-catch P2002 for idempotency", "conditional updateMany for LWW"]
key-files:
  created:
    - src/lib/meetingSelect.ts
    - src/app/api/health/route.ts
    - src/app/api/meetings/[id]/speakers/route.ts
  modified:
    - prisma/schema.prisma
    - src/app/api/meetings/route.ts
    - src/app/api/meetings/[id]/route.ts
    - src/app/api/meetings/[id]/process/route.ts
    - src/app/meetings/[id]/page.tsx
    - README.md
key-decisions:
  - "Schema fields are nullable and additive; every read names columns and falls back to legacy columns on P2022"
  - "Foreign-owned id on POST returns 409 with only an error key (no data leak)"
requirements-completed: [OFF-03]
duration: 15min
completed: 2026-11-21
---

# Phase 2 Plan 01: Server contract for local-first clients Summary

Additive server contract: client-generated ids create meetings once, titles resolve by last-writer-wins, the list exposes a `since` cursor plus full id set, and everything degrades to legacy columns if the schema has not been pushed.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 Schema, selects, legacy fallback | eee3332 | `prisma generate` only |
| 2 Idempotent create, since list, health | 94a2cb9 | |
| 3 PATCH LWW, speakers route, README | c859c07 | |

## User action required

Run `npx prisma db push` on the Neon database before or together with deploying this build. Claude did not run it (no DB commands were executed). Until then the app works via the P2022 legacy fallback and logs `Schema not pushed yet; using legacy columns`. After the push, verify manually: POST the same `{id}` twice (201 then 200), PATCH a title with an older `titleUpdatedAt` (title unchanged), GET `/api/meetings?since=<serverTime>` lists a just-patched meeting.

## Deviations from Plan

None - plan executed as written. `npm run typecheck` and `npm run build` pass.

## Known Stubs

None.

## Self-Check: PASSED
