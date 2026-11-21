---
phase: 03-offline-app-shell-gating
plan: 02
subsystem: offline
tags: [connectivity, feature-gate, auth-decision, node-test]
requires: []
provides:
  - "connectivityCore reduce() hysteresis reducer"
  - "useConnectivity()/getConnectivity() store; legacy isReachable/markUnreachable/onConnectivityHint preserved"
  - "featureGateCore gate()/effectiveEngine(), useFeatureGate()"
  - "authCore decideAuth(), authStore setAuthStatus/useAuthStatus"
affects: [03-05, 03-06]
tech-stack:
  added: []
  patterns: ["pure core modules with no imports, tested by node --test", "useSyncExternalStore with 'unknown' server snapshot"]
key-files:
  created: [src/lib/connectivityCore.ts, src/lib/featureGateCore.ts, src/lib/featureGate.ts, src/lib/authCore.ts, src/lib/authStore.ts, tests/connectivityCore.test.ts, tests/featureGate.test.ts, tests/authCore.test.ts]
  modified: [src/lib/connectivity.ts]
decisions:
  - "Pure cores take plain string engine values so tests avoid the @/ alias"
metrics:
  tasks: 2
  completed: 2026-11-21
requirements: [OFF-04, OFF-05, OFF-06]
---

# Phase 3 Plan 02: Connectivity, gating, auth decision Summary

Reachability is now a probe-driven store (`useConnectivity`) with one-retry hysteresis, and the feature gate and auth decision table exist as pure, tested functions. 85 tests pass, typecheck clean.

## Commits
- c4c1008: connectivity reducer and store
- fd80740: feature gate, authCore, authStore

## Deviations from Plan
None. The decideAuth Probe type also includes "pending" (required by the behavior table).

## Notes
- sync.ts untouched; legacy isReachable now shares the probe with the store.

## Self-Check: PASSED
