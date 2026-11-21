# Roadmap: Transcriber

## Overview

This milestone fixes the existing Transcriber web app and Android app so it works on a phone, anywhere. First, exports, the share sheet and navigation get fixed, and every new native plugin ships in one APK. Next comes a local-first meeting store with sync to the server. On top of that store we add the offline app shell, offline sign-in and gating of online-only features. On-device speaker separation is built on the same store (parallel with the offline shell). Last, the screens get the "Aurora Ink" redesign with motion, and a new signed APK is built and checked on the Xiaomi phone.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Export, Share & Navigation** - TXT/DOCX/PDF exports and native share work in the APK and on the web, nav fixed, all new native plugins in one APK
 (completed 2026-11-21)
- [ ] **Phase 2: Local-First Meetings & Sync** - Meetings live on the device (Dexie) and sync to the server reliably with client IDs and idempotent upserts
- [ ] **Phase 3: Offline App Shell & Gating** - The app opens, stays signed in and records on-device with no internet; online-only features are clearly gated
- [ ] **Phase 4: On-Device Speaker Separation** - Moonshine/Whisper transcripts say who said what, renamable, used by AI minutes
- [ ] **Phase 5: Aurora Ink Redesign & Release** - Alive, modern, simple UI with motion; signed APK built and verified on the Xiaomi phone

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
  4. Tapping the "Transcriber" brand goes to Record from anywhere. Every meeting page has a back arrow to the meetings list, even when opened directly with no history
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
**Plans:** 5 plans

Plans:
- [ ] 02-01-PLAN.md — Server contract, additive: schema fields + prisma generate, explicit selects with P2022 fallback, idempotent client-id POST, title LWW/speakerNames PATCH, speakers relabel, ?since list, /api/health (wave 1)
- [ ] 02-02-PLAN.md — Device store: Dexie per-user DB (meetings + sibling transcripts table), repo, pure syncCore with node:test tests, connectivity probe (wave 1)
- [ ] 02-03-PLAN.md — Sync engine (Web Locks, triggers, create/tail/meta/finish/delete push, serverTime pull, flush) + SyncProvider with orphan recovery (wave 2)
- [ ] 02-04-PLAN.md — Recorder integration: local-first useRecorder with legacy fallback, native mirror, save badge (wave 3)
- [ ] 02-05-PLAN.md — UI integration: merged meetings list with sync badges, device fallback meeting page, local-first rename/delete, flush before AI minutes (wave 3)

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
**Plans**: TBD
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
**Plans**: TBD

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
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases run in numeric order: 1 -> 2 -> 3 -> 4 -> 5 (Phase 4 may run in parallel with Phase 3 once Phase 2 is done)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Export, Share & Navigation | 4/4 | Complete   | 2026-11-21 |
| 2. Local-First Meetings & Sync | 0/5 | Not started | - |
| 3. Offline App Shell & Gating | 0/TBD | Not started | - |
| 4. On-Device Speaker Separation | 0/TBD | Not started | - |
| 5. Aurora Ink Redesign & Release | 0/TBD | Not started | - |

---
*Roadmap created: 2026-11-20*
