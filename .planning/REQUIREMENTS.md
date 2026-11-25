# Requirements: Minutely (formerly Transcriber)

**Defined:** 2026-11-20
**Core Value:** Record a whole meeting on a phone, anywhere — with or without internet — and come away with a transcript that says who said what, which can be turned into minutes and shared in one tap.

## v1 Requirements

### Export & Share

- [x] **SHARE-01**: User can export a meeting's transcript as TXT inside the Android app and on the website (file actually saves/opens)
- [x] **SHARE-02**: User can export minutes/transcript as a real Word (.docx) file inside the Android app and on the website
- [x] **SHARE-03**: User can export minutes/transcript as PDF inside the Android app and on the website, including long meetings and Hindi (Devanagari) text, without the "Couldn't make the PDF" error
- [x] **SHARE-04**: User can tap "Share" on a meeting and get the native share sheet (WhatsApp, Drive, Telegram, Messages, Gmail, copy…) with the minutes or transcript as a file or text — in the Android app (Capacitor Share) and on web/iOS browsers (Web Share API), with a download fallback
- [x] **SHARE-05**: Web code keeps working on older installed APKs that lack the new native plugins (feature detection + fallback)

### Navigation

- [x] **NAV-01**: Tapping the app brand/logo goes to the home/Record screen from anywhere
- [x] **NAV-02**: Every sub-page (meeting page, etc.) has a visible back arrow that returns to its parent (meetings list) even with no history
- [x] **NAV-03**: Android hardware/gesture back closes open sheets, then goes back, and never exits the app while recording (minimizes instead)

### Offline

- [x] **OFF-01**: After one online visit, the app (Android and website) opens with no internet: Record, Meetings list and meeting pages all render
- [x] **OFF-02**: User can record with the on-device models (Moonshine / Whisper) with no internet; the chosen models can be downloaded ahead for offline use, with clear "ready offline" status
- [x] **OFF-03**: Meetings recorded or edited offline are stored on the device and sync to the server automatically when internet returns, without duplicates or lost text
- [x] **OFF-04**: Offline state is visible (an "Offline" indicator), based on real reachability, not just navigator.onLine
- [x] **OFF-05**: Cloud (Deepgram) recording and AI minutes generation are only available online; offline they are shown disabled with a one-line reason, and become available when back online
- [x] **OFF-06**: Signed-in user stays signed in while offline (no bounce to the login page)

### Speakers

- [x] **SPK-01**: Recordings made with Moonshine or Whisper label each phrase with a speaker (Speaker 1, Speaker 2…) computed on the device, no internet needed
- [x] **SPK-02**: Speaker labels are refined after the recording ends (re-clustering) and the improved labels are saved
- [x] **SPK-03**: User can rename a speaker once and the name applies across the transcript, exports and AI minutes
- [x] **SPK-04**: AI minutes attribute statements/decisions/actions to speakers for on-device recordings (as already done for Deepgram)
- [x] **SPK-05**: Speaker separation doesn't make live transcription fall behind on a mid-range phone

### UI Redesign

- [x] **UI-01**: New visual direction ("Aurora Ink" from research): tinted, non-pure-black dark theme and a light theme, single electric accent, depth (soft elevation, subtle gradient), applied through design tokens
- [x] **UI-02**: Record screen feels alive: mic-reactive visual (orb/waveform), animated record→stop button, clear live state, with a calm low-power mode during long recordings
- [x] **UI-03**: Motion and micro-interactions across the app (press feedback, page/list transitions, tab changes, toasts), respecting reduced motion
- [x] **UI-04**: Meetings list and meeting page redesigned: readable cards, Share as primary action, Minutes/Transcript tabs, friendly empty states
- [x] **UI-05**: Stays simple: no new clutter; works at phone width and laptop width; light and dark both pass contrast

### Release

- [x] **REL-01**: A new signed release APK with the new native plugins is built and verified on the Xiaomi phone (export, share, offline open, offline record)

### Polish (Phase 6)

- [x] **POL-01**: Floating recording pill has working pause/resume and stop (native and in-page recorders), body tap goes to Record, visible on laptop too
- [x] **POL-02**: Light-mode contrast fixes: Switch off track, radio ring, idle timer (≥3:1)
- [x] **POL-03**: Token hygiene: type scale, radii and 4 px spacing grid on shared primitives; toast offset above the tab bar

### Speaker names (Phase 7)

- [x] **NAME-01**: On-device detection of self-introductions (English + common Hindi/Hinglish) suggests names for speaker labels
- [x] **NAME-02**: Online AI name suggestions with evidence, using the existing AI provider chain
- [x] **NAME-03**: Suggestions are accepted/dismissed by the user; accepted names go through the existing rename path

## v1.1 Requirements

Shipped as quick tasks after Phase 8 (see ROADMAP.md, Phase 9).

### Meeting follow-through

- [x] **TASK-01**: User can extract action items from a meeting with AI, review them, and save the ones they keep
- [x] **TASK-02**: User has a task tracker (`/tasks`) with manual status, owner, due date and notes for saved action items
- [x] **TASK-03**: User can prepare a follow-up agenda from unfinished tasks

### Scheduling

- [x] **SCHED-01**: User can set up a public booking link (`/schedule` host page, `/book` public pages with a slot picker and confirmation)
- [x] **SCHED-02**: User can schedule a follow-up meeting from the agenda sheet, using the booking flow

### Account & app

- [x] **ADMIN-01**: Admin usage dashboard at `/admin`, protected by a password (stored only as a scrypt hash in an environment variable)
- [x] **APP-01**: In-app APK update prompt and a profile page (app version, update and install)
- [x] **BRAND-01**: App renamed to Minutely (formerly Transcriber); Android applicationId and storage keys unchanged

## v2 Requirements

### Offline recording with screen locked

- [x] **OFF-V2-01**: On-device (offline) recording continues with the phone locked in the Android app (native capture into a file, transcribed by the page / native ONNX). Shipped in Phase 8; device UAT pending

### Speakers

- **SPK-V2-01**: Merge two speakers; split a phrase when the speaker changes mid-phrase (pyannote segmentation)

### Performance

- **PERF-V2-01**: Multi-threaded ONNX inside the Android WebView (androidx.webkit cross-origin isolation allowlist)

### Backlog (not scheduled)

- **BACK-01**: Per-account usage limits
- **BACK-02**: Link a booking to its recording (`Booking.meetingId`)
- **BACK-03**: Action items for meetings that have not synced yet
- **BACK-04**: Laptop tab-audio capture for online calls
- **BACK-05**: Reminders (overdue tasks, upcoming bookings)
- **BACK-06**: Google Calendar sync
- **BACK-07**: Vercel project rename to a minutely URL (needs a new APK)
- **BACK-08**: Guest time zone in booking emails
- **BACK-09**: Per-host email cap for public bookings

## v2.0 Requirements (Full meeting lifecycle)

### Safety foundations (Phase 10)

- [ ] **SAFE-01**: Pull requests get a Vercel preview on a separate Neon branch database
- [ ] **SAFE-02**: Schema changes are tracked Prisma migrations (baseline plus safety tables), not `db push` on production
- [ ] **SAFE-03**: CI runs typecheck, tests and build on every pull request and push to main
- [ ] **SAFE-04**: Client and server errors are logged and shown in an admin Errors list
- [ ] **SAFE-05**: Features can be turned on or off from the admin panel without a deploy
- [ ] **SAFE-06**: One release script bumps the version in both places, builds and publishes the APK

### Later steps

- [x] **DUP-01**: Saving action items, bookings and agendas twice never creates duplicates (Phase 11)
- [x] **DUP-02**: Review leftovers from week-REVIEW.md closed (Phase 11)
- [x] **HIST-01**: Edits to tasks and meetings keep a visible change history (Phase 11)
- [x] **STK-01**: User keeps a stakeholders directory: name, designation, area of involvement, email (Phase 12)
- [x] **STK-02**: Stakeholders are searchable and reusable wherever a person is picked (Phase 12)
- [x] **PLAN-01**: User can plan a meeting with time, venue or link, attendees and agenda (Phase 13)
- [x] **PLAN-02**: Meetings can repeat as a series (Phase 13)
- [x] **PLAN-03**: Record starts from a planned meeting, prefilled and linked (Phase 13)
- [ ] **PRE-01**: Reference files can be attached to a planned meeting (Phase 14)
- [ ] **PRE-02**: AI turns reference files into editable agenda points (Phase 14)
- [ ] **CAL-01**: Common free slots are shown for selected internal users (Phase 15)
- [ ] **CAL-02**: Chosen slots are blocked for everyone and invites are sent (Phase 15)
- [ ] **CAL-03**: Recurring series block every occurrence (Phase 15)
- [ ] **TRK-01**: Task owners are picked from stakeholders (Phase 16)
- [ ] **TRK-02**: Timeline view and overdue alerts for tasks (Phase 16)
- [ ] **TRK-03**: Series progress shows done vs open (Phase 16)
- [ ] **FUP-01**: "Plan next meeting" opens a prefilled planned meeting (Phase 17)
- [ ] **FUP-02**: Unfinished tasks are carried into the next agenda (Phase 17)
- [ ] **CALL-01**: Laptop tab-audio capture for online calls (Phase 18)
- [ ] **CALL-02**: Meeting bot for online calls on phone and laptop (Phase 18)
- [ ] **PRIV-01**: Recording consent notice before recording (Phase 19)
- [ ] **PRIV-02**: Public privacy page (Phase 19)
- [ ] **PRIV-03**: User can delete their account and data (Phase 19)
- [ ] **ADDR-01**: App served from a new web address with the old one kept working (Phase 20)
- [ ] **ADDR-02**: Sync-first migration and a new APK for the new address (Phase 20)

## Out of Scope

| Feature | Reason |
|---------|--------|
| iOS native app build | No Mac/iOS toolchain; web share works in iOS Safari |
| Bundling the web app inside the APK | Breaks auth cookie, API calls, COOP/COEP; service worker on server.url chosen instead |
| Claude running Vercel deploys / tunnels | User constraint |
| API keys in the APK | Security |
| Always-on animated backgrounds / heavy glass | Battery and Xiaomi performance during 10-hour recordings |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHARE-01 | Phase 1 | Complete |
| SHARE-02 | Phase 1 | Complete |
| SHARE-03 | Phase 1 | Complete |
| SHARE-04 | Phase 1 | Complete |
| SHARE-05 | Phase 1 | Complete |
| NAV-01 | Phase 1 | Complete |
| NAV-02 | Phase 1 | Complete |
| NAV-03 | Phase 1 | Complete |
| OFF-01 | Phase 3 | Complete |
| OFF-02 | Phase 3 | Complete |
| OFF-03 | Phase 2 | Complete |
| OFF-04 | Phase 3 | Complete |
| OFF-05 | Phase 3 | Complete |
| OFF-06 | Phase 3 | Complete |
| SPK-01 | Phase 4 | Complete |
| SPK-02 | Phase 4 | Complete |
| SPK-03 | Phase 4 | Complete |
| SPK-04 | Phase 4 | Complete |
| SPK-05 | Phase 4 | Complete |
| UI-01 | Phase 5 | Complete |
| UI-02 | Phase 5 | Complete |
| UI-03 | Phase 5 | Complete |
| UI-04 | Phase 5 | Complete |
| UI-05 | Phase 5 | Complete |
| REL-01 | Phase 5 | Complete |
| POL-01..03 | Phase 6 | Complete (device UAT pending) |
| NAME-01..03 | Phase 7 | Complete (device UAT pending) |
| OFF-V2-01 | Phase 8 | Complete (device UAT pending) |
| TASK-01 | Phase 9 (quick tasks) | Complete |
| TASK-02 | Phase 9 (quick tasks) | Complete |
| TASK-03 | Phase 9 (quick tasks) | Complete |
| SCHED-01 | Phase 9 (quick tasks) | Complete |
| SCHED-02 | Phase 9 (quick tasks) | Complete |
| ADMIN-01 | Phase 9 (quick tasks) | Complete |
| APP-01 | Phase 9 (quick tasks) | Complete (device UAT pending) |
| BRAND-01 | Phase 9 (quick tasks) | Complete |
| SAFE-01..06 | Phase 10 | Pending |
| DUP-01..02 | Phase 11 | Complete (needs UAT) |
| HIST-01 | Phase 11 | Complete (needs UAT, apply 2_history) |
| STK-01..02 | Phase 12 | Complete (needs UAT, apply 3_stakeholders) |
| PLAN-01..03 | Phase 13 | Complete (needs UAT, apply 4_planned_meetings) |
| PRE-01..02 | Phase 14 | Pending |
| CAL-01..03 | Phase 15 | Pending |
| TRK-01..03 | Phase 16 | Pending |
| FUP-01..02 | Phase 17 | Pending |
| CALL-01..02 | Phase 18 | Pending |
| PRIV-01..03 | Phase 19 | Pending |
| ADDR-01..02 | Phase 20 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- v1.1 requirements: 9 total, all complete
- Unmapped: 0

---
*Requirements defined: 2026-11-20*
*Last updated: 2026-11-25 after v1.1 quick-task batch and rename to Minutely*
