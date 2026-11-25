# Roadmap: Minutely (formerly Transcriber)

## Overview

This milestone fixes the existing Transcriber web app and Android app so it works on a phone, anywhere. First, exports, the share sheet and navigation get fixed, and every new native plugin ships in one APK. Next comes a local-first meeting store with sync to the server. On top of that store we add the offline app shell, offline sign-in and gating of online-only features. On-device speaker separation is built on the same store (parallel with the offline shell). Then the screens get the "Aurora Ink" redesign with motion, and a new signed APK is built and checked on the Xiaomi phone. Finally, meetings are followed through with action items, a task tracker, a follow-up agenda and scheduling (Phase 9, shipped as quick tasks).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Export, Share & Navigation** - TXT/DOCX/PDF exports and native share work in the APK and on the web, nav fixed, all new native plugins in one APK
 (completed 2026-11-21)
- [x] **Phase 2: Local-First Meetings & Sync** - Meetings live on the device (Dexie) and sync to the server reliably with client IDs and idempotent upserts
 (completed 2026-11-21)
- [x] **Phase 3: Offline App Shell & Gating** - The app opens, stays signed in and records on-device with no internet; online-only features are clearly gated
 (completed 2026-11-21)
- [x] **Phase 4: On-Device Speaker Separation** - Moonshine/Whisper transcripts say who said what, renamable, used by AI minutes
- [x] **Phase 5: Aurora Ink Redesign & Release** - Alive, modern, simple UI with motion; signed APK built and verified on the Xiaomi phone (completed 2026-11-23)
- [x] **Phase 6: UI Polish Leftovers** - Recording pill gets pause/stop, contrast/type/radius/spacing fixes from the Phase 5 UI review (code complete 2026-11-24, device UAT pending)
- [x] **Phase 7: Automatic Speaker Names** - Speakers who introduce themselves ("Hi, I'm Priya") get their names suggested and applied in one tap (code complete 2026-11-24, device UAT pending)
- [x] **Phase 8: Offline Recording With Screen Locked** - On-device (free, offline) recording keeps going with the phone locked in the Android app (code complete 2026-11-24, device UAT pending)
- [x] **Phase 9: Meeting follow-through (shipped as quick tasks)** - Action items, task tracker, follow-up agenda, scheduling, profile, admin dashboard and the Minutely rename (shipped 2026-11-25, device UAT pending for APK 1.2)

## Phase Details

### Phase 1: Export, Share & Navigation
**Goal**: Users can export and share any meeting from the Android app or the website in one tap, and they can always find their way back
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, NAV-01, NAV-02, NAV-03
**Success Criteria** (what must be TRUE):
  1. In the Android app and on the website, tapping TXT, Word or PDF on a meeting produces a real file that opens. This includes a long Hindi (Devanagari) meeting as PDF, with no "Couldn't make the PDF" error
  2. Tapping "Share" opens the native share sheet (WhatsApp, Drive, Telegram, Gmail, copy...) with the minutes or transcript as a file or text. Browsers without Web Share fall back to a download
  3. An older installed APK that lacks the new plugins still loads the new web code, and exports fall back gracefully instead of crashing
  4. Tapping the brand name goes to Record from anywhere. Every meeting page has a back arrow to the meetings list, even when opened directly with no history
  5. The Android back button closes open sheets first, then goes back. It never exits the app while recording (it minimizes instead)
**Plans:** 4/4 plans complete

Plans:
- [x] 01-01-PLAN.md — Navigation slice: brand link, history-aware back arrow, Android back handler; installs all milestone plugins + native.ts capability layer (wave 1)
- [x] 01-02-PLAN.md — DocumentExport Android plugin (HTML to PDF + print fallback), cap sync, assembleDebug compile proof (wave 2)
- [x] 01-03-PLAN.md — Text / real Word (.docx) / PDF exports through one delivery path with old-APK fallbacks (wave 2)
- [x] 01-04-PLAN.md — Share menu (sheet/popover) with share minutes/transcript + copy, overlay back integration, html2pdf.js removed (wave 3)
**UI hint**: yes

### Phase 2: Local-First Meetings & Sync
**Goal**: Every meeting is stored on the device first and reaches the server reliably, with no duplicates and no lost text
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: OFF-03
**Success Criteria** (what must be TRUE):
  1. A meeting recorded or edited while the server is unreachable is still on the device after closing and reopening the app
  2. When internet returns, those meetings show up on the server (e.g. from a laptop browser) on their own, with full text and no duplicate rows
  3. Killing the app mid-sync or sending a sync twice never truncates or duplicates the transcript; AI minutes created on the server are not overwritten by the device
  4. Existing online recording (Deepgram and on-device) keeps autosaving exactly as before, with no regression
**Plans:** 5/5 plans complete

Plans:
- [x] 02-01-PLAN.md — Server contract, additive: schema fields + prisma generate, explicit selects with P2022 fallback, idempotent client-id POST, title LWW/speakerNames PATCH, speakers relabel, ?since list, /api/health (wave 1)
- [x] 02-02-PLAN.md — Device store: Dexie per-user DB (meetings + sibling transcripts table), repo, pure syncCore with node:test tests, connectivity probe (wave 1)
- [x] 02-03-PLAN.md — Sync engine (Web Locks, triggers, create/tail/meta/finish/delete push, serverTime pull, flush) + SyncProvider with orphan recovery (wave 2)
- [x] 02-04-PLAN.md — Recorder integration: local-first useRecorder with legacy fallback, native mirror, save badge (wave 3)
- [x] 02-05-PLAN.md — UI integration: merged meetings list with sync badges, device fallback meeting page, local-first rename/delete, flush before AI minutes (wave 3)

### Phase 3: Offline App Shell & Gating
**Goal**: After one online visit, users can open the app, browse meetings and record on-device with no internet, and they always know what needs a connection
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: OFF-01, OFF-02, OFF-04, OFF-05, OFF-06
**Success Criteria** (what must be TRUE):
  1. With airplane mode on, the Android app and the website open to Record, the Meetings list and meeting pages render, and the user is not sent to the login page
  2. User can download the chosen Moonshine/Whisper models ahead of time, see a "ready offline" status, and then record and transcribe a meeting with no internet
  3. An "Offline" indicator appears when the server is really unreachable (including on Wi-Fi with no internet) and disappears when it is reachable again
  4. Offline, Deepgram Cloud recording and AI minutes generation show as disabled with a one-line reason, and they turn on automatically when back online
  5. After a new deploy, the app keeps working (no broken chunks, cross-origin isolation kept) and never reloads in the middle of a recording
**Plans:** 8/8 plans complete

Plans:
- [x] 03-01-PLAN.md — Hand-written service worker pipeline: pure routing/manifest + tests, SW template generated in `next build` via compiler.runAfterProductionCompile, check-build script (wave 1)
- [x] 03-02-PLAN.md — Pure cores + stores: connectivity store/useConnectivity, feature gate + effective engine, auth decision table, auth store (wave 1)
- [x] 03-03-PLAN.md — SW client: registration, recording-safe update flow, chunk-error recovery, Update notice, APK errorPath copy (wave 1)
- [x] 03-04-PLAN.md — Static shells in (app) route group, MeetingLoader (/meeting?id=), Dexie-based Meetings list, /offline page, nav parent (wave 2)
- [x] 03-06-PLAN.md — Model readiness from Cache Storage, worker cache-status/prefetch, offline-safe load, Download for offline control (wave 2)
- [x] 03-05-PLAN.md — AuthProvider/AuthGate on own session probe, SyncProvider/AppShell off useSession, Offline pill + explainer, offline-aware /login, SW manager mounted (wave 3)
- [x] 03-07-PLAN.md — Gating UI: Cloud engine + AI minutes disabled with reason, effective on-device engine offline, honest screen-on copy, download control + Start gate in Recorder (wave 3)
- [x] 03-08-PLAN.md — Wiring verification: typecheck/tests/build/check-build, local offline smoke on port 3001, HUMAN-UAT device checklist (wave 4)
**UI hint**: yes

### Phase 4: On-Device Speaker Separation
**Goal**: Recordings made with the free on-device engines say who said what, fully on the device, without slowing live transcription
**Mode:** mvp
**Depends on**: Phase 2 (can run in parallel with Phase 3; starts with a device performance spike)
**Requirements**: SPK-01, SPK-02, SPK-03, SPK-04, SPK-05
**Success Criteria** (what must be TRUE):
  1. While recording with Moonshine or Whisper (online or offline), each phrase shows a label (Speaker 1, Speaker 2...) computed on the device
  2. After stopping, the speaker labels are refined and the improved labels are saved with the meeting
  3. User renames "Speaker 1" to a name once, and the name appears across the transcript, TXT/Word/PDF exports and AI minutes
  4. AI minutes for an on-device recording attribute statements, decisions and actions to speakers, as they do for Deepgram meetings
  5. On the Xiaomi phone, live transcription with speaker separation keeps up with speech during a long meeting (no growing backlog)
**Plans:** 8/8 plans complete

Plans:
- [x] 04-01-PLAN.md — Spike first (scripts/diarize-bench.mjs, 04-BENCHMARK.md, phone UAT item) + pure clustering core diarize.ts with tests (wave 1)
- [x] 04-02-PLAN.md — SPEAKER_MODEL, pure embedSchedule rules, worker embedding class (lowest priority, crop, skip) + client API (wave 1)
- [x] 04-03-PLAN.md — speakerLabel helper, names in TXT/Word/PDF exports, AI minutes route names + D-12 prompt (wave 1)
- [x] 04-04-PLAN.md — Dexie v2 embeddings table, setRelabel, sync speakers step via /speakers parts overrides (wave 1)
- [x] 04-05-PLAN.md — Speaker chip, rename sheet, status line, hint; meeting page rename + names in exports (wave 2)
- [x] 04-06-PLAN.md — Offline download/readiness includes the speaker model (wave 2)
- [x] 04-07-PLAN.md — useRecorder: live labels, stop-time refine with name mapping, relabel sync, live rename (wave 2)
- [x] 04-08-PLAN.md — Record screen wiring, phase gate + audits, complete HUMAN-UAT (wave 3)

### Phase 5: Aurora Ink Redesign & Release
**Goal**: The app feels alive, modern and still simple on phone and laptop, and a verified signed APK ships with everything from this milestone
**Mode:** mvp
**Depends on**: Phase 1, Phase 3, Phase 4
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, REL-01
**Success Criteria** (what must be TRUE):
  1. The app uses the Aurora Ink tinted dark theme (not pure black) and a light theme, with one electric accent and soft depth, applied consistently through design tokens
  2. The Record screen reacts to the mic (orb/waveform), the record button morphs to stop, the live state is obvious, and a calm low-power mode kicks in during long recordings
  3. Presses, page/list transitions, tab changes and toasts animate smoothly, and the animations turn off when reduced motion is set
  4. The meetings list and meeting page have readable cards, Share as the primary action, Minutes/Transcript tabs and friendly empty states. Both themes pass contrast at phone and laptop width, with no new clutter
  5. A new signed release APK with all the native plugins is installed on the Xiaomi phone, and export, share, offline open and offline record are verified there
**Plans:** 7/7 plans complete

Plans:
- [x] 05-01-PLAN.md — Aurora Ink tokens (light/dark), Geist fonts, motion tokens/keyframes, glass, reduced-motion switches, contrast test, haptics helper (wave 1)
- [x] 05-02-PLAN.md — ui.tsx primitives restyle (pill buttons, sliding Segmented, Switch), motion preference store, Toast provider, Waveform (wave 1)
- [x] 05-03-PLAN.md — Shell: glass tab bar, sidebar, page enter, Offline pill, floating native recording pill, Login/Offline pages (wave 2)
- [x] 05-04-PLAN.md — Record hero: orb, record->stop morph, waveform, engine Segmented, Options disclosure, Reduce motion, calm mode (wave 2)
- [x] 05-05-PLAN.md — Meetings list: date groups, cards, status chips, stagger, shimmer skeleton, empty states (wave 2)
- [x] 05-06-PLAN.md — Meeting page: Share primary, Minutes|Transcript tabs, AI card, speaker-ruled transcript, chips, toasts (wave 2)
- [x] 05-07-PLAN.md — Phase gate (typecheck/test/build/check-build/audits/smoke) + 05-HUMAN-UAT.md; APK build is a post-review orchestrator step (wave 3)
**UI hint**: yes

### Phase 6: UI Polish Leftovers
**Goal**: The leftover issues from the Phase 5 UI review are fixed, and the floating recording pill can pause and stop
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: POL-01, POL-02, POL-03
**Success Criteria** (what must be TRUE):
  1. The floating recording pill (shown on other screens while recording) has pause/resume and stop buttons that work for both the native (Cloud, APK) and the in-page recorders; tapping its body still goes to Record; it also shows on laptop width
  2. Switch off-track, radio ring and idle timer pass 3:1 contrast in light mode
  3. No off-scale type (`text-[13px]`, `text-[2rem]`, stray `text-lg/xl`), no `rounded-lg/xl` stragglers, no half-step spacing on the shared primitives; toast sits just above the tab bar unless a pill/bar is shown
**Plans:** 1/1 plans complete

Plans:
- [x] 06-01-PLAN.md — Recording pill pause/stop, contrast, type/radius/spacing and toast offset fixes (wave 1)
**UI hint**: yes

### Phase 7: Automatic Speaker Names
**Goal**: People who say their name during the meeting get it attached to their speaker label without manual renaming
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: NAME-01, NAME-02, NAME-03
**Success Criteria** (what must be TRUE):
  1. On-device (no internet) detection finds self-introductions in the transcript ("I'm Priya", "my name is Rahul", "this is Anil from sales", common Hindi forms like "mera naam ... hai") and suggests "Speaker 2 → Priya"
  2. Online, the AI (same provider chain as AI minutes) can suggest names from context (introductions, people addressing each other), returning only names with evidence quotes
  3. Suggestions are shown on the meeting page (and after stopping a recording) as chips the user accepts or dismisses; nothing is renamed without a tap; accepted names flow through the existing rename (transcript, exports, AI minutes, sync)
**Plans:** 3/3 plans complete

Plans:
- [x] 07-01-PLAN.md — Pure detection core + tests
- [x] 07-02-PLAN.md — aiErrors extraction + POST /api/speaker-names
- [x] 07-03-PLAN.md — Hook, chips UI, MeetingView/Recorder wiring
**UI hint**: yes

### Phase 8: Offline Recording With Screen Locked
**Goal**: In the Android app, a free on-device recording (Moonshine/Whisper) keeps capturing with the screen locked and nothing is lost
**Mode:** mvp
**Depends on**: Phase 3, Phase 4
**Requirements**: OFF-V2-01
**Success Criteria** (what must be TRUE):
  1. In the APK, starting an on-device recording runs the native foreground service capture; audio keeps being captured with the screen locked for a long meeting (1h+), with no internet
  2. Captured audio is transcribed on the device (with speaker labels) — live when the WebView is running, and any backlog is caught up when the screen comes back on — with no gaps or duplicates
  3. Stopping from the notification, the app, or the Meetings panel finalizes the meeting; the backlog audio is deleted from the phone once transcribed; old APKs and the website keep working as before
**UI hint**: no
**Plans**: 4 plans
- [x] 08-01-PLAN.md — Native local capture (LocalCapture, RecordingService mode "local", plugin read/release/list/discard) (wave 1)
- [x] 08-02-PLAN.md — Feed-mode VoiceChunker, nativeFeed helpers, embedding batch flag, nativeCapabilities (wave 1)
- [x] 08-03-PLAN.md — useRecorder native session (pump, catch-up, committed cursor, detach/resume), Dexie fields, Record copy (wave 2)
- [x] 08-04-PLAN.md — Recovery of left-behind captures, offline stop paths, storage notices, 08-HUMAN-UAT.md (wave 3)

### Phase 9: Meeting follow-through (shipped as quick tasks)
**Goal**: After a meeting, the user can turn what was said into tasks, track them, plan the follow-up meeting, and book meetings with others, all from the same app
**Mode:** quick-task batch (not a planned GSD phase)
**Status**: Shipped 2026-11-25. Device UAT for the APK parts (Share, update banner, profile install) is pending with APK 1.2.
**Shipped work** (commit refs):
- Action items: extract from a meeting with AI, review, then save (`85a237e`)
- Task tracker at `/tasks`: manual status, owner, due date and notes (`b1220da`)
- Follow-up agenda: prepare from unfinished tasks (`e7ed81b`)
- Scheduling: schema and slot engine (`b765a9b`), host settings and booking APIs (`b96183e`), host Schedule page (`9700878`), public booking pages, slot picker and confirmation (`5a2fe66`), schedule a follow-up from the agenda sheet (`20a4fa4`), ICS and name hardening (`f40aff2`), simpler booking setup and page (`71aa698`)
- Profile page with app version, in-app update and install (`d471bef`), in-app APK update banner (`b3cf396`)
- Admin usage dashboard at `/admin`, password-protected (`227d9bf`)
- Rename to Minutely, Android app 1.2 (versionCode 3) (`6e1a198`, `2308491`)

## Backlog

Not scheduled. Captured for a future milestone:
- Per-account usage limits
- Booking to recording link (`Booking.meetingId`)
- Action items for meetings that have not synced yet
- Laptop tab-audio capture for online calls
- Reminders (overdue tasks, upcoming bookings)
- Google Calendar sync
- Vercel project rename to a minutely URL (needs a new APK, since the APK points at the Vercel URL)
- Guest time zone in booking emails
- Per-host email cap for public bookings

## Progress

**Execution Order:**
Phases run in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 (Phase 4 may run in parallel with Phase 3 once Phase 2 is done). Phase 9 was shipped as quick tasks after Phase 8.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Export, Share & Navigation | 4/4 | Complete   | 2026-11-21 |
| 2. Local-First Meetings & Sync | 5/5 | Complete   | 2026-11-21 |
| 3. Offline App Shell & Gating | 8/8 | Complete   | 2026-11-21 |
| 4. On-Device Speaker Separation | 8/8 | Code complete (device UAT pending) | 2026-11-23 |
| 5. Aurora Ink Redesign & Release | 7/7 | Complete   | 2026-11-23 |
| 6. UI Polish Leftovers | 1/1 | Code complete (device UAT pending) | 2026-11-24 |
| 7. Automatic Speaker Names | 3/3 | Code complete (device UAT pending) | 2026-11-24 |
| 8. Offline Recording With Screen Locked | 4/4 | Code complete (device UAT pending) | 2026-11-24 |
| 9. Meeting follow-through (quick tasks) | n/a | Shipped (APK 1.2 device UAT pending) | 2026-11-25 |

---
*Roadmap created: 2026-11-20*
