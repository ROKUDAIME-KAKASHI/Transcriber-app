# Requirements: Transcriber

**Defined:** 2026-11-20
**Core Value:** Record a whole meeting on a phone, anywhere — with or without internet — and come away with a transcript that says who said what, which can be turned into minutes and shared in one tap.

## v1 Requirements

### Export & Share

- [ ] **SHARE-01**: User can export a meeting's transcript as TXT inside the Android app and on the website (file actually saves/opens)
- [ ] **SHARE-02**: User can export minutes/transcript as a real Word (.docx) file inside the Android app and on the website
- [ ] **SHARE-03**: User can export minutes/transcript as PDF inside the Android app and on the website, including long meetings and Hindi (Devanagari) text, without the "Couldn't make the PDF" error
- [ ] **SHARE-04**: User can tap "Share" on a meeting and get the native share sheet (WhatsApp, Drive, Telegram, Messages, Gmail, copy…) with the minutes or transcript as a file or text — in the Android app (Capacitor Share) and on web/iOS browsers (Web Share API), with a download fallback
- [ ] **SHARE-05**: Web code keeps working on older installed APKs that lack the new native plugins (feature detection + fallback)

### Navigation

- [ ] **NAV-01**: Tapping the "Transcriber" brand/logo goes to the home/Record screen from anywhere
- [ ] **NAV-02**: Every sub-page (meeting page, etc.) has a visible back arrow that returns to its parent (meetings list) even with no history
- [ ] **NAV-03**: Android hardware/gesture back closes open sheets, then goes back, and never exits the app while recording (minimizes instead)

### Offline

- [ ] **OFF-01**: After one online visit, the app (Android and website) opens with no internet: Record, Meetings list and meeting pages all render
- [ ] **OFF-02**: User can record with the on-device models (Moonshine / Whisper) with no internet; the chosen models can be downloaded ahead for offline use, with clear "ready offline" status
- [ ] **OFF-03**: Meetings recorded or edited offline are stored on the device and sync to the server automatically when internet returns, without duplicates or lost text
- [ ] **OFF-04**: Offline state is visible (an "Offline" indicator), based on real reachability, not just navigator.onLine
- [ ] **OFF-05**: Cloud (Deepgram) recording and AI minutes generation are only available online; offline they are shown disabled with a one-line reason, and become available when back online
- [ ] **OFF-06**: Signed-in user stays signed in while offline (no bounce to the login page)

### Speakers

- [ ] **SPK-01**: Recordings made with Moonshine or Whisper label each phrase with a speaker (Speaker 1, Speaker 2…) computed on the device, no internet needed
- [ ] **SPK-02**: Speaker labels are refined after the recording ends (re-clustering) and the improved labels are saved
- [ ] **SPK-03**: User can rename a speaker once and the name applies across the transcript, exports and AI minutes
- [ ] **SPK-04**: AI minutes attribute statements/decisions/actions to speakers for on-device recordings (as already done for Deepgram)
- [ ] **SPK-05**: Speaker separation doesn't make live transcription fall behind on a mid-range phone

### UI Redesign

- [ ] **UI-01**: New visual direction ("Aurora Ink" from research): tinted, non-pure-black dark theme and a light theme, single electric accent, depth (soft elevation, subtle gradient), applied through design tokens
- [ ] **UI-02**: Record screen feels alive: mic-reactive visual (orb/waveform), animated record→stop button, clear live state, with a calm low-power mode during long recordings
- [ ] **UI-03**: Motion and micro-interactions across the app (press feedback, page/list transitions, tab changes, toasts), respecting reduced motion
- [ ] **UI-04**: Meetings list and meeting page redesigned: readable cards, Share as primary action, Minutes/Transcript tabs, friendly empty states
- [ ] **UI-05**: Stays simple: no new clutter; works at phone width and laptop width; light and dark both pass contrast

### Release

- [ ] **REL-01**: A new signed release APK with the new native plugins is built and verified on the Xiaomi phone (export, share, offline open, offline record)

## v2 Requirements

### Offline recording with screen locked

- **OFF-V2-01**: On-device (offline) recording continues with the phone locked in the Android app (native capture into a file, transcribed by the page / native ONNX)

### Speakers

- **SPK-V2-01**: Merge two speakers; split a phrase when the speaker changes mid-phrase (pyannote segmentation)

### Performance

- **PERF-V2-01**: Multi-threaded ONNX inside the Android WebView (androidx.webkit cross-origin isolation allowlist)

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
| SHARE-01 | Phase 1 | Pending |
| SHARE-02 | Phase 1 | Pending |
| SHARE-03 | Phase 1 | Pending |
| SHARE-04 | Phase 1 | Pending |
| SHARE-05 | Phase 1 | Pending |
| NAV-01 | Phase 1 | Pending |
| NAV-02 | Phase 1 | Pending |
| NAV-03 | Phase 1 | Pending |
| OFF-01 | Phase 3 | Pending |
| OFF-02 | Phase 3 | Pending |
| OFF-03 | Phase 2 | Pending |
| OFF-04 | Phase 3 | Pending |
| OFF-05 | Phase 3 | Pending |
| OFF-06 | Phase 3 | Pending |
| SPK-01 | Phase 4 | Pending |
| SPK-02 | Phase 4 | Pending |
| SPK-03 | Phase 4 | Pending |
| SPK-04 | Phase 4 | Pending |
| SPK-05 | Phase 4 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| UI-05 | Phase 5 | Pending |
| REL-01 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-11-20*
*Last updated: 2026-11-20 after roadmap creation*
