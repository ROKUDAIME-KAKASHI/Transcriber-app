---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: device-testing
stopped_at: Post-roadmap quick work shipped (Minutely 1.2, versionCode 3)
last_updated: "2026-11-25T00:00:00.000Z"
last_activity: 2026-11-25
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 40
  completed_plans: 40
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-25)

**Core value:** Record a whole meeting on a phone, anywhere — with or without internet — and come away with a transcript that says who said what, which can be turned into minutes and shared in one tap.
**Current focus:** Device testing of Phases 4–8 on the Xiaomi phone (Minutely 1.2 APK)

## Current Position

Phase: 8 of 8 (Offline Recording With Screen Locked) — code complete, device UAT pending
Status: Phases 1–8 code complete. Device UAT pending for Phases 4–8.
Post-roadmap work: shipped as quick tasks (see Phase 9 in ROADMAP.md)
Last activity: 2026-11-25

Progress: [██████████] 100% (code)

## Performance Metrics

**Velocity:**

- Total plans completed: 40 (Phases 1–8)
- Quick tasks shipped after the roadmap: see the table below (action items, tracker, agenda, scheduling, profile, admin, update banner, rename)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: All new Capacitor plugins (share, filesystem, app, network, haptics, DocumentExport) ship in the Phase 1 APK rebuild, so there is a single APK rebuild; web code feature-detects plugins (SHARE-05)
- [Roadmap]: PDF via native print-to-PDF plugin (Android) / print iframe (web); html2pdf.js removed
- [Roadmap]: Keep `server.url`; offline via service worker on the Vercel origin, not by bundling the app into the APK
- [Roadmap]: Local-first data layer (Phase 2) is split from the offline shell (Phase 3) so diarization (Phase 4) can run in parallel with Phase 3
- [Roadmap]: Screen-off offline recording (OFF-V2-01) shipped in Phase 8 (code complete); device UAT pending
- [Quick]: Product renamed to Minutely; APK applicationId stays `in.transcriber.app` and storage keys keep "transcriber" names

### Pending Todos

None in the GSD workflow. See Pending User Actions below.

### Pending User Actions

- [ ] Run `npx prisma db push` against Neon (ActionItem and scheduling tables)
- [ ] Set `ADMIN_PASSWORD_HASH` in Vercel project env (scrypt hash only; never store the password or hash in the repo)
- [ ] Optional: set `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` in Vercel for booking emails (email is skipped without them)
- [ ] Install Minutely 1.2 (versionCode 3) APK on the Xiaomi phone and on testers' phones
- [ ] Run the HUMAN-UAT checklists for Phases 4–8 on the device

### Blockers/Concerns

- Phase 4: WeSpeaker int8 speed on the Xiaomi phone and whether ORT is single-threaded in the WebView still need device confirmation; cosine thresholds need tuning on real recordings
- Phase 8: screen-locked capture and catch-up on the device is unverified (HUMAN-UAT pending)
- Unproven: `navigator.storage.persist()` in the Android WebView; sync body limit (4.5 MB / about 2000 parts per batch)
- C: drive nearly full: no emulator; test on the Xiaomi phone over adb

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Backlog | Per-account usage limits, booking to recording link, action items for unsynced meetings, laptop tab-audio capture, reminders, Google Calendar sync, Vercel rename to a minutely URL, guest time zone in booking emails, per-host email cap | See ROADMAP.md Backlog | 2026-11-25 |

## Session Continuity

Last session: 2026-11-25
Stopped at: Documentation housekeeping (STATE, ROADMAP, REQUIREMENTS, PROJECT) after Minutely 1.2
Resume file: None

### Quick Tasks Completed

| Date | Task | Commit |
|------|------|--------|
| 2026-11-23 | stop-stuck-recording (.planning/quick/20261123-stop-stuck-recording) | fbb7b53 |
| post-roadmap | In-app APK update banner | b3cf396 |
| post-roadmap | Admin usage dashboard at /admin | 227d9bf |
| post-roadmap | Action items extract, review and save | 85a237e |
| post-roadmap | Task tracker at /tasks | b1220da |
| post-roadmap | Follow-up agenda | e7ed81b |
| post-roadmap | Scheduling (/schedule, /book) | b765a9b..f40aff2 |
| post-roadmap | Profile page | d471bef |
| post-roadmap | Simpler booking setup | 71aa698 |
| post-roadmap | Rename to Minutely; APK 1.2 | 6e1a198, 2308491 |
