---
phase: 07
plan: 02
requirements-completed: [NAME-02]
key-files:
  created: [src/lib/aiErrors.ts, src/app/api/speaker-names/route.ts]
  modified: ["src/app/api/meetings/[id]/process/route.ts"]
commit: fc542a4
---
# Phase 7 Plan 2: AI route Summary

`aiFailure`/`unwrapFence` moved to `src/lib/aiErrors.ts` (process route imports them, behaviour unchanged). New stateless `POST /api/speaker-names`: sign-in required, zod caps (400 lines, 500 chars each, 20k total, speaker <= 49), `summaryModel("glm")` + `generateText`, lenient JSON parse, and only suggestions whose evidence quote is a literal line substring containing the name are returned. Not exercised against the live provider (no curl with a session in this run).

## Deviations
None.

## Self-Check: PASSED
