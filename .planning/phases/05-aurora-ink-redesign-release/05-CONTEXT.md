# Phase 5: Aurora Ink Redesign & Release - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Restyle every screen with the "Aurora Ink" direction (tinted dark, light theme, one electric accent, soft depth, motion that reacts to sound), make the Record screen feel alive, redesign the meetings list and meeting page, then build a signed release APK pointing at the live site. Content and features stay the same; only look, feel and motion change. Website and Android behaviour (export/share, offline, sync, diarization, native recorder) must not regress. No deploy, no push, no tunnels; the APK is built but not installed (the owner tests on phones after deploying).

Requirements: UI-01, UI-02, UI-03, UI-04, UI-05, REL-01 (REL-01 verified on phone by the owner later).
</domain>

<decisions>
## Implementation Decisions

### Tokens and theme (UI-01)
- **D-01:** Spec is `.planning/research/FEATURES.md` "Design Direction". Dark: bg #0E0F17, surface #171926, surface-2 #20233A, border #2A2D44, text #EDEEF5, muted #9A9DB3, accent #8EA2FF, record #FF6369, success #3DD68C, warning #F5B544. Light: bg #F7F7FB, surface #FFFFFF, surface-2 #EFF0F6, border #E2E4EE, text #14151F, muted #5B5F73, accent #3651F5, record #E5484D, success #1A7F5A, warning #A15C00.
- **D-02:** Keep the existing Tailwind token names (`background`, `card`, `muted`, `border`, `foreground`, `muted-foreground`, `accent`, `accent-foreground`, `danger`, `success`, `warning`) so components keep compiling; change values and add new tokens (`--record`, `--surface-2`, `--accent-soft`, `--glow-a/b`, shadow/depth tokens, motion tokens). `danger` maps to the record colour. Theme follows `prefers-color-scheme` (existing behaviour); no manual theme toggle (keep simple).
- **D-03:** Speaker palette updated to the FEATURES.md light/dark sets (6 colours); `--speaker-*` tokens keep working in SpeakerChip/TranscriptView.
- **D-04:** Depth: cards get layered soft shadow (light) / inner top highlight + shadow (dark) with a hairline border; faint fixed radial tint at the top of the page; glass (blur + translucent surface) ONLY on floating chrome (bottom tab bar, recording pill, toast) with solid `--card` fallback under `@supports not (backdrop-filter)`.
- **D-05:** Shape: radii 10 chips/inputs, 14 buttons, 22 panels/sheets, full for pills and the record button. Primary buttons are pill-shaped, min-height 48 on touch.
- **D-06:** `themeColor` meta and PWA/manifest/icon colours updated to the new bg colours.

### Typography
- **D-07:** Geist Sans + Geist Mono through `next/font/google` (self-hosted at build, no runtime CDN, COEP-safe), replacing Inter. Mono for timer, durations and timestamps with tabular-nums. Scale: 13 meta, 15 UI, 16-17 reading, 20/24/32, recorder timer 56. Headings 600 with -0.015em tracking.

### Motion (UI-03)
- **D-08:** CSS-first. Tokens: `--dur-1..4` = 120/200/320/500 ms, `--ease-out`, `--ease-in-out`, `--spring` (CSS `linear()`). Animate only transform and opacity (plus colour on small elements). No new runtime dependency by default; `tw-animate-css` and `motion` are optional and used only if CSS cannot do the job (planner/UI-SPEC decides; default is none).
- **D-09:** Every Button/card/tab press: `active:scale-[0.96]` (cards .98), 120 ms. Page enter: fade + translateY(8px) 320 ms. Lists: stagger 30 ms max 8 items. Sheets/toasts/segmented thumb use the spring. View Transitions API / `experimental.viewTransition` is NOT adopted (experimental risk); route enter animation is a plain CSS class.
- **D-10:** Reduced motion: keep the global CSS kill switch for `prefers-reduced-motion` AND add an in-app "Reduce motion" toggle (persisted in localStorage, sets `data-motion="reduced"` on `<html>`, same CSS rules). Waveform becomes a static level bar when reduced.
- **D-11:** Haptics via the already-installed `@capacitor/haptics`, behind feature detection (`Capacitor.isPluginAvailable("Haptics")`, try/catch, never throws; old APKs skip). Used for record start/stop, tab change, copy/share done, no-sound warning. Add a tiny `haptics.ts` helper in `src/lib`.
- **D-12:** Never steal CPU from live transcription: animations compositor-only; mic-level visuals driven from existing `rec.micLevel` (~12/s, already throttled) with CSS transitions or a single lightweight rAF loop that pauses when `document.hidden` or paused; no extra analysers, no layout-thrashing, no per-frame React state.

### Record screen (UI-02)
- **D-13:** Hero card: aurora orb (two radial gradients, blur, scale/opacity from smoothed mic level; idle slow breathe), 88 px record button that morphs (500 ms spring) to a 72 px rounded-square stop with a pulsing live ring; pause/resume as 56 px circular secondaries sliding in; 56 px Geist Mono timer with a blinking live dot ("Recording" / "Paused" warning colour, no blink); scrolling waveform (56 bars) replacing the LED LevelMeter; engine picker is the existing Segmented control with a sliding thumb; mic/language/tab-audio/battery options collapse into an "Options" disclosure so the hero stays uncluttered. All existing functionality and gating (offline Cloud disabled with reason) stays.
- **D-14:** Calm mode: after 10 minutes of continuous recording (or when the battery-saver option is on), the orb and waveform animation stop and become a static low-power display (small steady level bar + live dot only); also paused when `document.hidden`. A subtle "Calm mode" note, tap on the hero resumes animation temporarily. Live transcript card keeps working; new text fades in 200 ms.
- **D-15:** Floating recording pill on other pages (glass, live dot, mono timer, mini 10-bar level, tap returns to Record), reusing existing recording-state plumbing.

### Meetings list and meeting page (UI-04)
- **D-16:** List: header, date-group labels (Today / Yesterday / This week / Earlier), cards with title (2 lines), mono meta row (duration, speakers, time), status chip (Minutes ready / On this phone / Syncing / transcript only) from data already available locally. Do not add new search; keep whatever filtering exists. Press feedback, staggered enter. Friendly empty state (orb illustration + "No meetings yet" + Start recording button).
- **D-17:** Meeting page: back chevron, title, header block (date, duration, speaker chips using existing SpeakerChip/RenameSpeakerSheet), **Share = primary full-width pill** (existing ShareMenu), Copy secondary, other formats inside the Share menu/sheet as today; segmented **Minutes | Transcript** tabs with sliding thumb (default Minutes when minutes exist, else Transcript); generate-minutes card in the Minutes tab keeping the model picker and offline gating. Transcript paragraphs: 3 px speaker-colour left rule, 17 px/1.6 reading size on phones. Do not change export/share logic.
- **D-18:** Toasts: one small `Toast` provider (glass, spring in, 2.5 s) used by existing copy/export/sync feedback where text messages currently appear; keep existing inline errors.

### Shell
- **D-19:** AppShell: sidebar (lg) and top bar/bottom tab bar (phones) restyled; bottom tab bar is glass floating chrome with an accent-soft active pill; logo uses the accent; ConnectivityPill restyled as warning-soft pill. Nav items and routes unchanged.

### Quality bar (UI-05)
- **D-20:** No new features or clutter; the same screens and controls. Both themes pass WCAG AA for text (use the contrast-verified token pairs above; text on accent in dark is #0E0F17). Check phone (375-390 px) and laptop (>=1280 px) widths, light and dark, via a built `npm run build && npm start` on port 3001.

### Release (REL-01)
- **D-21:** After all code is committed: `CAP_SERVER_URL=https://transcriber-app-ten.vercel.app npx cap sync android`, then `gradlew assembleRelease` in `android/` (signing via gitignored `android/keystore.properties`, never printed), `apksigner verify` from Android SDK build-tools, copy to `dist/Transcriber.apk` (gitignored). Not installed; device verification (export, share, offline open, offline record) stays as HUMAN-UAT for the owner.

### Claude's Discretion
- Exact component split (new files such as Orb, Waveform, Toast, haptics.ts), CSS class names, orb sizes, keyframes, stagger values, status-chip copy, and whether `tw-animate-css` is used at all.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec
- `.planning/research/FEATURES.md` section "Design Direction - Aurora Ink" - colours, typography, shape, motion tokens, record screen, list, meeting page, empty states, toasts, sheets (the spec).
- `.planning/research/STACK.md` section "UI motion" - CSS-first, `tw-animate-css` optional, `motion` only where CSS cannot, View Transitions are experimental (not adopted, D-09).
- `.planning/research/PITFALLS.md` - animation/CPU and WebView pitfalls.
- `.planning/REQUIREMENTS.md` - UI-01..05, REL-01.
- `.planning/ROADMAP.md` - Phase 5 goal and success criteria.
- `CLAUDE.md` - constraints (no deploys/tunnels, secrets never printed, C: drive nearly full, must work as website and in the APK, COEP: no external CDNs).

### Prior phases (do not regress)
- `.planning/phases/01-export-share-navigation/` - ShareMenu, exports, overlays/back handling.
- `.planning/phases/03-offline-app-shell-gating/` - ConnectivityPill, feature gating, offline shell.
- `.planning/phases/04-on-device-speaker-separation/` - SpeakerChip, RenameSpeakerSheet, speaker colours.

### Release
- `android/` Gradle project and `android/keystore.properties` (gitignored, never print), `capacitor.config.*` (reads CAP_SERVER_URL).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui.tsx`: Button, Panel, Segmented, Badge, LiveDot, Notice, GateReason, OptionList; restyle here first so most screens update at once.
- `src/app/globals.css`: token block + `@theme inline` + reduced-motion kill switch; extend rather than replace.
- `src/components/Recorder.tsx` (LevelMeter, rec.micLevel, recording pill near L531), `MeetingList.tsx`, `MeetingView.tsx`, `TranscriptView.tsx` (memoised, must stay so), `ShareMenu.tsx`, `SpeakerChip.tsx`, `RenameSpeakerSheet.tsx`, `AppShell.tsx`, `ConnectivityPill.tsx`, `UpdateNotice.tsx`, `src/app/login/page.tsx`, `src/app/offline/page.tsx`.
- `src/lib/native.ts` (capability layer, `isPluginAvailable` pattern), `src/lib/overlays.ts` (back button closes sheets).

### Established Patterns
- Tailwind v4 with `@theme inline` tokens; components use semantic classes (`bg-card`, `text-muted-foreground`).
- `useRecorder` publishes `micLevel` (~12/s, throttled 80 ms); TranscriptView is memoised for that reason.
- Tests run with `node --test "tests/*.test.ts"` (pure logic only); UI has no component tests.

### Integration Points
- `src/app/layout.tsx` (font + themeColor), `Providers.tsx` (Toast provider, motion preference), `AppShell.tsx` (glass chrome, floating pill).
</code_context>

<specifics>
## Specific Ideas

User words: "make the UI much more active", "feels so static", "not full black", "attractive, easy to use, really simple, not too complicated". One focal element per screen; simple layouts.
</specifics>

<deferred>
## Deferred Ideas

- Swipe actions and long-press sheets on meeting cards.
- Manual light/dark toggle.
- View Transitions route morphs (`experimental.viewTransition`).
- Predictive back animation.
- Multi-threaded ONNX in the APK (androidx.webkit 1.18 allowlist spike).
- Search on the meetings list if it does not already exist.
</deferred>

---

*Phase: 5-Aurora Ink Redesign & Release*
*Context gathered: 2026-11-23*
