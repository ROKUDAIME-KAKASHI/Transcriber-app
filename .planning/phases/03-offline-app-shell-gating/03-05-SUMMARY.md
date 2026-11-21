---
phase: 03-offline-app-shell-gating
plan: 05
subsystem: auth-offline
tags: [auth-gate, session-probe, connectivity-pill, offline-login]
requires: ["03-02", "03-03", "03-04"]
provides:
  - "AuthProvider/useAuth: own /api/auth/session probe, cached {id,email}"
  - "AuthGate wrapping (app) layout via decideAuth"
  - "ConnectivityPill in phone top bar and laptop sidebar"
  - "Offline-aware /login; ServiceWorkerManager mounted once in Providers"
affects: [03-07, 03-08]
key-files:
  created: [src/components/AuthProvider.tsx, src/components/AuthGate.tsx, src/components/ConnectivityPill.tsx]
  modified: [src/components/Providers.tsx, src/components/SyncProvider.tsx, src/components/AppShell.tsx, "src/app/(app)/layout.tsx", src/app/login/page.tsx]
decisions:
  - "A failed probe after an ok-user probe keeps the signed-in state (network error is never a sign-out)"
  - "needs-reauth set from sync snapshot 'needs-auth' and reverted to app/other when it clears"
metrics:
  tasks: 3
  completed: 2026-11-21
requirements: [OFF-01, OFF-04, OFF-06]
---

# Phase 3 Plan 05: Offline sign-in state and connectivity pill Summary

next-auth's client provider is gone: AuthProvider probes `/api/auth/session` itself (fetch error, 6 s timeout, non-OK and non-JSON all count as unreachable), caches only id and email, and AuthGate renders the app for a cached user offline, redirects to /login only when the server answers with no session, and shows "Sign in needs internet once" with Try again when there is no cached user. A neutral Offline pill with an explainer appears only when the server is really unreachable.

## Commits
- da3adc1: AuthProvider, AuthGate, SyncProvider, Providers, (app) layout
- ConnectivityPill + AppShell commit (sign-out disabled offline, Meetings tab active for /meeting)
- offline-aware /login commit (submit disabled offline, reachability pre-check before signIn)

## Deviations
None of substance. Pill and AuthGate styling followed UI-SPEC from the plan text; AuthGate waits 7 s via a timer to feed decideAuth's grace window.

## Verification
typecheck clean, npm test 110 pass, npm run build and check-build pass. No `useSession`/`SessionProvider` left in src. Offline behaviour is untested on device (plan 08 smoke + HUMAN-UAT).

## Self-Check: PASSED
