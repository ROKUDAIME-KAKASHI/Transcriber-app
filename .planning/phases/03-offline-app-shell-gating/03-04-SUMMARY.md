---
phase: 03-offline-app-shell-gating
plan: 04
subsystem: offline
tags: [static-shells, route-group, dexie, meeting-loader]
requires: ["03-01", "03-02"]
provides:
  - "(app) route group layout with AppShell; static /, /meetings, /meeting, /offline"
  - "MeetingLoader (Dexie -> API -> not-on-device), resolveMeetingId, /meetings/[id] redirect"
affects: [03-05]
key-files:
  created: [src/lib/meetingRoute.ts, tests/meetingRoute.test.ts, "src/app/(app)/layout.tsx", "src/app/(app)/meeting/page.tsx", src/app/offline/page.tsx]
  modified: [src/components/MeetingLoader.tsx, src/components/MeetingList.tsx, src/components/Recorder.tsx, src/lib/navStack.ts, "src/app/meetings/[id]/page.tsx", tsconfig.json]
decisions:
  - "tsconfig allowImportingTsExtensions (noEmit) so node --test can load meetingRoute.ts which imports ./meetingId.ts"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-01]
---

# Phase 3 Plan 04: Static app shells Summary

Record, Meetings, Meeting and Offline now prerender as static HTML. Meetings list and meeting page read from Dexie, falling back to /api/meetings/:id when reachable, else an honest "Not on this device yet". Old /meetings/<id> links redirect to /meeting?id=<id>.

## Commits
- 717c137: (app) route group, static shells, meetingRoute + navStack + tests
- 4bbdfc0, third commit "MeetingLoader content...": MeetingLoader, /meeting, redirect, /offline (the file rename landed in 4bbdfc0 and the content in the following commit because of a staging slip)
- 585ff71: MeetingList on device rows, Recorder links

## Deviations
- [Rule 3] tsconfig `allowImportingTsExtensions` added so the test can import the helper.
- MeetingList sync badge only for pending rows; pulled/synced rows now appear (filter removed).
- When no user id is known after 1.5 s, MeetingLoader fetches from the server directly and renders from the response.

## Verification
typecheck, npm test (101 pass), npm run build, check-build all pass (incl. shell assertions 7).
Needs device check: offline render of shells from SW cache (plan 05+).

## Self-Check: PASSED
