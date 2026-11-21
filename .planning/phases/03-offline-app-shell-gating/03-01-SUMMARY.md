---
phase: 03-offline-app-shell-gating
plan: 01
subsystem: offline
tags: [service-worker, precache, next-build-hook, node-test]
requires: []
provides:
  - "sw/routing.js route()/shellFor()"
  - "sw/manifest.js selectPrecache()/makeVersion()"
  - "sw/build.mjs buildServiceWorker() generating public/sw.js after next build"
  - "scripts/check-build.mjs post-build gate"
  - "src/lib/meetingId.ts client-safe MEETING_ID_RE"
affects: [03-03, 03-04, 03-08]
tech-stack:
  added: []
  patterns: ["hand-written SW generated via compiler.runAfterProductionCompile", "CJS-guarded pure modules shared by SW and node tests"]
key-files:
  created: [sw/routing.js, sw/manifest.js, sw/sw.template.js, sw/build.mjs, scripts/check-build.mjs, src/lib/meetingId.ts, tests/swRouting.test.ts, tests/swManifest.test.ts]
  modified: [next.config.ts, .gitignore, package.json, src/lib/meetingSelect.ts]
  deleted: [public/sw.js (now generated, gitignored), public/offline.html]
decisions:
  - "Dynamic import of sw/build.mjs uses new Function('u','return import(u)') because next.config.ts is transpiled to CJS"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-01]
---

# Phase 3 Plan 01: SW pipeline Summary

A stock `next build` now generates `public/sw.js` (46 hashed assets, filtered precache, ORT wasm in a lazy tier, single skipWaiting behind a SKIP_WAITING message, COOP/COEP on synthetic responses), covered by 58 passing node tests and a check-build script.

## Commits
- 1bc9fc7: routing/manifest modules, meetingId.ts, tests
- a751502: SW template, build hook, old sw.js/offline.html removed
- 20024f2: check-build script, test/check-build npm scripts

## Deviations from Plan
**[Rule 3 - Blocking]** `import()` in next.config.ts was compiled to `require()` by Next's config transpile, failing the build. Replaced with `new Function("u","return import(u)")`. No other deviations.

## Known state / for later plans
- `node scripts/check-build.mjs`: assertions 1-5 and login shell pass. Shells for `/`, `/meetings`, `/meeting`, `/offline` are not static yet (fail by design until plan 04). Until then the SW install would reject (shell fetches fail), which is the intended fail-safe; registration lands in plan 03.
- Typecheck, `npm test` (58 pass), `npm run build` all pass.

## Self-Check: PASSED
