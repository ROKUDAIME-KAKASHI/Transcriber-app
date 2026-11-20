# Feature Research

**Domain:** Mobile-first meeting recorder / transcriber (Next.js 16 web app in a Capacitor 8 Android shell), redesign + export/offline/diarization/navigation milestone
**Researched:** 2026-11-20
**Confidence:** MEDIUM overall. Platform behaviour (Capacitor App/Share/Haptics, Web Share in WebView) is HIGH/MEDIUM from official docs. Competitor UI patterns are MEDIUM, from reviews and press coverage. The design direction is an opinionated synthesis, not a verified fact.

---

## Where the current UI stands (read from code)

- `globals.css`: a warm neutral palette that is close to monochrome. Dark mode is `#0f0f0e` with `#171716` cards, which reads as "full black". Cards are 1 px hairlines with no shadows, and the nav is opaque with no blur. Colour is deliberately kept out of the chrome ("colour comes from content").
- Motion: none beyond `transition-colors`, `active:scale-95` and a spinner. Reduced motion is already handled globally, which is good; keep it.
- Recorder hero: a mic button, a 6-bar `LevelMeter`, a status line and the timer. There is no ambient state, no glow and no haptics.
- Font: Inter with cv11/ss01.
- Logo already links to `/`, but only the Record tab benefits. Sub-pages (`/meetings/[id]`) have no back affordance, and there is no Android `backButton` handling.
- Export uses `download()` with an anchor blob, which fails silently in the Android WebView. `navigator.share` is feature-detected but is undefined in Android WebView (see below).

The user's complaint ("static, full black, plain") maps exactly to these rules: zero-chroma surfaces, no depth, no motion, no state colour. The fix is to add **tint, depth, light and motion that respond to state**, while keeping the layout simple.

---

## What the leading apps do (2025–2026)

| App | Visual / UX traits worth copying | Confidence |
|-----|----------------------------------|------------|
| Granola | "Invisible" design: just a notepad during the meeting. Reviewers call it the cleanest AI-tool UI. Calm warm-paper surfaces, very few controls, and AI output that visually separates *your* words from *AI* words. | MEDIUM (reviews) |
| Pixel Recorder (Material 3 Expressive redesign, Aug 2025) | Simplified capture screen, a **larger, more prominent play/record button**, larger waveforms, a pill-shaped search field, and secondary actions moved into an overflow bottom sheet. Reception was mixed: removing too much hurt discoverability. | MEDIUM (9to5Google, Android Authority) |
| Otter / Fireflies | Speaker chips with avatar initials and colours, tap-to-rename that applies to all occurrences, a summary/action-items tab above the transcript, keyword search, share links. They get dense and feature-heavy, which is the "complicated" this user does not want. | MEDIUM |
| Apple Voice Memos / Notes (iOS 18+) | One big red record control with a live scrolling waveform, a transcript that appears inline, and summaries on top. Liquid Glass (iOS 26) uses translucent, light-refracting floating controls and tab bars. | MEDIUM |
| Plaud / Limitless | Hardware-first. The apps centre on a "templates" picker for summary type and a clean card list grouped by day. | LOW (training data) |
| Linear / Vercel / Raycast style | Tinted near-black (blue-grey, never #000), 1 px inner highlights instead of heavy borders, subtle radial glows behind key elements, fast 150–250 ms motion, Geist/Inter typography, monospace numerals. | MEDIUM |

**Synthesis:** the current generation look is calm surfaces plus one living, glowing focal element, physical (spring) motion, translucent floating chrome, and big touch targets. It is not "more stuff on screen". Material 3 Expressive's research framing and Pixel Recorder both point to one dominant action, bigger shapes and springy feedback.

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Export works in the app (TXT, DOCX, PDF)** | Every competitor exports. A button that does nothing reads as a broken app. | MEDIUM | In Capacitor, write the file with `@capacitor/filesystem` to `Directory.Cache` (base64 for binary), then `Share.share({ files: [uri] })`. Cache is the only folder the official Share plugin can share from without editing `file_paths.xml`. Generate PDFs as real vector PDFs (pdf-lib, jsPDF text API, or server-side), not html2pdf canvas rasterising, which is what fails in the WebView. Produce real `.docx` (the `docx` npm lib) rather than HTML-as-`.doc`. |
| **Native share sheet ("Share to WhatsApp, Drive, Telegram…")** | Phone users expect the OS sheet, not downloads. | LOW–MEDIUM | `navigator.share` is **not implemented in Android WebView** (Capacitor discussion #3213, Chromium bug 765923), so it must go through `@capacitor/share` when `Capacitor.isNativePlatform()`. On the web, use `navigator.canShare({files})` then `navigator.share({files})`, falling back to an anchor download. One `shareOrDownload(file)` helper serves both. Offer share as **text** (paste into WhatsApp) and as a **file**. |
| **Copy to clipboard** | The fastest share path. Everyone has it. | LOW | "Copy minutes" / "Copy transcript" with a toast "Copied" and a light haptic. |
| **Clear recording state** | Users must know with certainty that it is recording, paused or stopped. | LOW | A big timer, a red live dot, a pulsing glow, the status in words, and the Android foreground notification (already there). |
| **Live level/waveform while recording** | Proof the mic hears you. Every recorder shows it. | LOW–MEDIUM | Upgrade the 6-bar meter to a scrolling waveform (last ~6 s, 48–64 bars), drawn on canvas or as CSS bars at about 30 fps. |
| **Pause / resume / stop with confirmation-free stop** | Standard. | LOW | Already present. Add haptics and the morphing animation (see Motion). |
| **Meeting list grouped by date with search** | Otter, Pixel Recorder and Voice Memos all do it. | LOW–MEDIUM | Sections "Today / Yesterday / This week / Earlier". Each card shows title, duration, speaker count, an engine badge, and a sync badge (local-only vs synced). Search by title and text. |
| **Rename meeting title inline** | Expected. | LOW | Tap the title to edit. Auto-title from the AI minutes when available. |
| **Speaker labels with colour + rename applying to all occurrences** | Otter, Grain, Reduct and Limecraft all rename "Speaker 1 → Anna" everywhere in one action. | MEDIUM | Store a `speakerNames: Record<number,string>` map on the meeting, not in each paragraph. Tap a speaker chip to open a bottom sheet: name field and "Apply to all N segments". Exports and AI minutes use the names. Merging two speakers ("these are the same person") is the next most requested fix after renaming. |
| **Offline indicator + gated online features** | Offline-first apps must say what is unavailable and why. | LOW–MEDIUM | A small pill in the top bar: "Offline". Online-only controls (Cloud engine, Generate minutes) stay *visible but disabled* with an inline reason ("Needs internet. Your recording is saved and minutes can be made later."). Never hide them silently. On reconnect, show a toast "Back online, syncing 2 meetings" and per-meeting sync state. |
| **Navigation basics** | Brand goes home, back arrow on sub-pages, and the Android back button behaves. | LOW | See the Navigation behaviour section. |
| **Light and dark themes following the system** | Expected in 2026. | LOW | Already media-query based. Add a manual override (System/Light/Dark) stored in localStorage, set before paint via an inline script to avoid a flash. |
| **Empty states that teach** | First-run users need a next step. | LOW | See Design Direction. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Works fully offline with on-device speaker labels** | Competitors (Otter, Fireflies, Granola) are cloud-only. "Record anywhere, no internet, still who-said-what" is this app's core value. | HIGH | Depends on the diarization research (separate dimension). UI: a "Private · on-device" badge on the meeting. |
| **Mic-reactive ambient hero** | Makes the app feel alive. The recording screen glows and breathes with the room's voice level. | MEDIUM | A radial gradient orb behind the record button, scaled and brightened by `micLevel` (smoothed). CSS custom property `--level` updated per animation frame. No WebGL needed. |
| **Expressive record button morph** | A signature interaction in the Material 3 Expressive style. | LOW–MEDIUM | Circle (idle) to rounded square (recording, "stop") with a spring. Pause shows two pills. Haptic on each change. |
| **Live transcript with "settling" words** | Moonshine is already word-by-word. Fade new words in from 40% to 100% opacity and blur from 4 px to 0 over 220 ms, which looks magical. | LOW | Pure CSS animation on new spans. Disable it under reduced motion. |
| **One-tap "Share minutes" smart default** | Core value is "shared in one tap". | LOW | The primary button on the meeting page is **Share**, defaulting to the minutes when they exist and the transcript otherwise. A format chooser is secondary. |
| **Speaker talk-time bar** | A quick visual read of a meeting. Fireflies has analytics, but this is the simple version. | LOW | A stacked horizontal bar in speaker colours under the meeting header, from segment durations. |
| **Recording survives everything, visibly** | Trust signal for 10-hour meetings. | LOW | Autosave chip "Saved 3 s ago" with a ✓ morph. "Saved on this phone" vs "Synced" states. |
| **Haptic language** | Feels native and premium inside the Android app. | LOW | `@capacitor/haptics`: `impact(Medium)` on record start, `impact(Light)` on pause/resume, `notification(Success)` on stop/saved and export done, `notification(Warning)` on the no-sound warning, `selectionChanged()` on segmented controls. Calls resolve silently on devices without a vibrator. Web: skip, or use `navigator.vibrate(10)` on Android Chrome only. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full Liquid Glass / heavy glassmorphism everywhere | "Modern", iOS 26 look | `backdrop-filter` over long scrolling transcripts is expensive on mid-range Android WebViews (the Xiaomi test device). Refraction needs Chromium-only SVG filters. Legibility suffers. | Glass **only** on floating chrome (bottom tab bar, top bar on scroll, the floating recording pill): `backdrop-filter: blur(16px) saturate(160%)` over an 72–80% opaque tinted fill, with a solid fallback via `@supports`. |
| Animated gradient backgrounds on every screen | "Active" | Battery drain during 10-hour recordings, distraction, and motion sickness. | The ambient glow lives only on the recorder hero and pauses when paused or hidden (`document.visibilityState`). |
| Bot that joins Zoom/Meet | Otter/Fireflies have it | Server infrastructure, cost and consent issues. Out of scope for a phone-in-the-room app. | The existing tab-audio capture on laptops. |
| Many export formats (SRT, VTT, JSON, MD, HTML…) up front | Completeness | Clutters the "simple" goal. | Primary: Share (text) and PDF. A secondary "More formats" sheet: Word, TXT. Add SRT later only if asked. |
| Mandatory naming of speakers before viewing | Accuracy | Friction. | Default "Speaker 1/2" with colours. Rename is optional at any time. |
| Hiding online-only features when offline | "Cleaner" | Users think the feature vanished or the app broke. | Show them disabled with a reason and queue them ("Make minutes when online"). |
| Confetti / gamified streaks | "Gen-Z" | Unprofessional in meeting minutes shared with colleagues. | Delight through micro-interactions and haptics only. |
| Pure black OLED theme as default | Battery | It is exactly what the user dislikes. | Tinted dark (`#0E0F17`). An optional "True black" toggle can come later. |
| Custom back-gesture handling that fights the OS | Control | Breaks predictive back and confuses users. | Use the Capacitor `backButton` with `canGoBack`, routed through the Next router (below). |

---

## Feature Dependencies

```
Local meeting store (IndexedDB) + sync queue
    └──required by──> Offline-first recording
    └──required by──> Offline indicator / per-meeting sync badge
    └──required by──> Export/share while offline (build files from local data)

shareOrDownload() helper (Capacitor Filesystem+Share | Web Share | anchor)
    └──required by──> TXT / DOCX / PDF export
    └──required by──> One-tap "Share minutes"

speakerNames map on Meeting (schema + local store)
    └──required by──> Rename speaker (apply to all)
    └──enhances────> Exports, AI minutes prompt, talk-time bar
On-device diarization ──enhances──> Speaker labels for Moonshine/Whisper meetings

Design tokens (globals.css rewrite) + motion primitives
    └──required by──> Recorder hero, list, meeting page, empty states
Haptics wrapper (no-op on web) ──enhances──> all state changes

Online status hook (navigator.onLine + fetch probe)
    └──required by──> Gated Cloud engine / AI minutes, offline pill, "make minutes when online" queue

Navigation (BackButton handler, back arrows) ──conflicts──> Capacitor default back handler
    (register listener ⇒ default disabled; must handle exitApp at root)
```

### Dependency Notes

- **Export requires shareOrDownload:** the WebView supports neither anchor downloads nor `navigator.share`, so every export path must go through one helper that branches on `Capacitor.isNativePlatform()`.
- **Speaker rename requires a names map:** keep transcript paragraphs storing a numeric `speaker` (as they do today) and resolve names at render and export time. Renaming is then one write, offline-safe, and syncable.
- **The design system should land before per-screen polish:** tokens, the `Button`/`Panel` updates and motion utilities in `ui.tsx`/`globals.css` come first, so screens restyle mostly by token change.
- **Gating requires the online hook:** `navigator.onLine` alone lies (captive Wi-Fi). Combine it with a cheap HEAD probe to `/api/health` on start and on `online` events.

---

## Navigation behaviour (expected)

| Element | Behaviour |
|---------|-----------|
| Brand "Transcriber" (top bar + sidebar) | Always `Link href="/"` (the Record home). If a recording is in progress and the user is on a meeting page, it returns to the live recorder, which must not restart or reset. |
| Sub-pages (`/meetings/[id]`) | A top-left back chevron (`ArrowLeft`, 44×44 hit area) labelled "Meetings". It uses `router.back()` when in-app history exists, else `router.push('/meetings')`, so deep links don't exit the app. |
| Bottom tabs | Record / Meetings. Tapping the active tab scrolls to the top. |
| Android hardware/gesture back | `App.addListener('backButton', ({canGoBack}) => …)`. Registering it **disables the default behaviour** (Capacitor docs). Order: 1) close any open sheet/dialog; 2) if not on a root route (`/`, `/meetings`), go back; 3) on `/meetings`, go to `/`; 4) on `/`: if recording, `App.minimizeApp()` (never exit and kill the session); else `App.exitApp()`, optionally after a "Press back again to exit" toast within 2 s. Remove the listener on unmount. |
| Predictive back (Android 14+) | Optional: needs `android:enableOnBackInvokedCallback="true"`. The custom listener above takes precedence. Leave it off this milestone unless testing shows the animation works with the custom handler. LOW confidence on the interaction. |
| Offline | All nav must be client-side routes served from the service worker / app-shell cache. No full-page loads. |

---

## Design Direction — "Aurora Ink"

One direction: **calm tinted surfaces, one electric accent, a living recorder.** Blue-indigo tinted neutrals (never #000 / pure grey), soft depth through inner highlights and layered shadows, translucent floating chrome, and spring motion that reacts to sound. Simple layouts with a single focal element per screen.

### 1. Color tokens

Contrast ratios computed for the key pairs; all text pairs meet WCAG AA.

**Light**

| Token | Hex | Use | Contrast |
|-------|-----|-----|----------|
| `--background` | `#F7F7FB` | App canvas (cool paper) | — |
| `--surface` (card) | `#FFFFFF` | Cards, sheets | — |
| `--surface-2` (muted) | `#EFF0F6` | Inputs, segmented bg, hover | — |
| `--border` | `#E2E4EE` | Hairlines (use sparingly) | — |
| `--foreground` | `#14151F` | Text | 17.0 on bg |
| `--muted-foreground` | `#5B5F73` | Meta text | 5.9 on bg |
| `--accent` | `#3651F5` | Primary buttons, links, focus, active tab | 5.75 vs white |
| `--accent-soft` | `color-mix(in oklab, #3651F5 12%, white)` ≈ `#E6E9FE` | Selected chips, active nav pill | — |
| `--record` | `#E5484D` | Record button, live dot only | 3.9 vs white icon (non-text OK) |
| `--success` | `#1A7F5A` | Saved/synced | 4.65 |
| `--warning` | `#A15C00` | Offline, no-sound | — |
| `--glow-a` / `--glow-b` | `#3651F5` / `#14B8C4` | Ambient gradient stops at 18–30% alpha | — |

**Dark** (tinted ink, not black)

| Token | Hex | Contrast |
|-------|-----|----------|
| `--background` | `#0E0F17` | — |
| `--surface` | `#171926` | — |
| `--surface-2` | `#20233A` | — |
| `--border` | `#2A2D44` (plus a top inner highlight `rgba(255,255,255,0.06)`) | — |
| `--foreground` | `#EDEEF5` | 16.5 on bg |
| `--muted-foreground` | `#9A9DB3` | 7.1 on bg, 6.5 on surface |
| `--accent` | `#8EA2FF` (text on it: `#0E0F17`) | 8.0 |
| `--record` | `#FF6369` | 6.6 on bg |
| `--success` | `#3DD68C` | 10.2 |
| `--warning` | `#F5B544` | — |
| `--glow-a` / `--glow-b` | `#5B6CFF` / `#22D3EE` at 22–35% alpha | — |

**Speaker palette** (content colour, as chips and the left rule of a paragraph). Light: `#3651F5`, `#0F8C7E`, `#C2600A`, `#C23A72`, `#5A7A12`, `#7A5AF0`. Dark: `#8EA2FF`, `#3CCFBC`, `#F4A955`, `#F483AE`, `#B0D163`, `#B39CFF`. (The old "no violet" rule can relax for speaker 6 only. Otherwise drop it.)

**Depth (replaces "hairline only, no shadows"):**
- Card light: `box-shadow: 0 1px 2px rgba(20,21,31,.04), 0 4px 16px -4px rgba(20,21,31,.06)`, plus a 1 px border `#E2E4EE` at 70%.
- Card dark: `box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 8px 24px -8px rgba(0,0,0,.5)` with the border `#2A2D44`.
- Floating chrome (tab bar, recording pill): `background: color-mix(in oklab, var(--surface) 78%, transparent); backdrop-filter: blur(16px) saturate(160%)`. Fall back to a solid `--surface` under `@supports not (backdrop-filter: blur(1px))`.
- Page background: a fixed, very faint radial tint at the top (`radial-gradient(1200px 600px at 50% -10%, color-mix(in oklab, var(--glow-a) 10%, transparent), transparent)`). This alone removes the "flat black" feel.

### 2. Typography

- **Geist Sans** (via `next/font/google`, variable) for UI and headings, and **Geist Mono** for the timer, durations and timestamps. Geist is the current Vercel/Linear-adjacent face. Keeping Inter is acceptable if a font change is undesired; the palette and motion matter more.
- Scale: 13 meta / 15 UI / 16 reading (transcript 17 px on phones, line-height 1.6) / 20 / 24 / 32. Recorder timer: 56 px mono, `font-variant-numeric: tabular-nums`, weight 500, tracking -0.02em.
- Headings weight 600, tracking -0.015em. Meta in `--muted-foreground`, never below 13 px.

### 3. Shape

Radii: 10 (chips, inputs), 14 (buttons), 22 (cards/sheets), full (pills, FAB, record button). Buttons min-height 48 on touch. Primary buttons are pill-shaped (`rounded-full`), in the Material 3 Expressive / iOS 26 style.

### 4. Motion principles

Keep it CSS-first. Tailwind v4 plus CSS `linear()` spring easings cover about 90%. Add `motion` (`motion/react`, `m` + `LazyMotion domAnimation`, about 5 kB initial) only for list enter/exit and layout animations of the record button morph if CSS proves awkward.

| Token | Value | Use |
|-------|-------|-----|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Enter, fade/slide |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Page/sheet transitions |
| `--spring` | `linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121 24%, 1.129 26.3%, 1.12 28.7%, 1.088 32.4%, 1.019 42.8%, 0.995 49.8%, 0.992 57.7%, 1.001 82%, 1)` at 500 ms | Record button morph, chip select, toast in (light overshoot, about M3 "expressive spatial" stiffness 380 / damping 0.8) |
| `--dur-1` | 120 ms | Press feedback (`scale(0.96)`), hover colour |
| `--dur-2` | 200 ms | Toggles, chip, fade-in of words |
| `--dur-3` | 320 ms | Sheets, page enter |
| `--dur-4` | 500 ms | Spring morph |

Rules:
1. **Every tap answers within 100 ms**: `active:scale-[0.96]` with 120 ms ease-out on all buttons and cards, plus a haptic on native.
2. **State changes move, content fades**: shapes use spring, text and colour use ease-out 200 ms.
3. **Page transitions**: enter `opacity 0 to 1` plus `translateY(8px to 0)` over 320 ms ease-out. Back navigation slides right-to-left (`translateX(-16px)`). Optionally use the View Transitions API (`document.startViewTransition`, supported in Chromium/Android WebView), with no-op fallback. MEDIUM confidence for Next 16 router integration (`experimental.viewTransition`), so test it.
4. **Lists**: stagger children by 30 ms (max 8 items, then no stagger), each 240 ms ease-out from `y: 6px, opacity 0`.
5. **Never animate during long recordings what isn't informative**: the ambient glow and waveform pause when `document.hidden` or paused.
6. **Reduced motion**: keep the existing global kill switch. The waveform becomes a static level bar and springs become instant.

### 5. Recording screen (hero)

- A full-width hero card (phones: most of the first viewport) with the ambient **aurora orb** behind the button: two radial gradients (`--glow-a`, `--glow-b`), 280 px, `filter: blur(40px)`, scaled `1 + level*0.35` and opacity `0.35 + level*0.5`, smoothed with lerp 0.15 per frame. Idle: a slow breathe, scale 0.96 to 1.04 over 4 s ease-in-out infinite, at 25% opacity.
- **Record button**: 88 px circle, `--record` fill, white mic icon, an outer 6 px ring of `--record` at 20%. On start it springs (500 ms) into a 72 px **rounded square (radius 22)** "stop" control, and a **live ring** pulses outward (scale 1 to 1.35, opacity .45 to 0, 1.6 s ease-out infinite). Pause and resume are 56 px circular secondary buttons that slide in from behind the main button (translateX ±72 px, spring).
- **Timer** above the button: 56 px Geist Mono. A red dot plus "Recording" label that blinks 1 Hz at opacity 1 to .35 (or "Paused" in warning colour, no blink).
- **Waveform** below: 56 bars, 3 px wide, 3 px gap, radius 2, height `max(4px, level*48px)`, scrolling left. Colour is `--accent` for recent bars, fading to `--muted-foreground` at 40% for older ones.
- **Engine picker**: a segmented control (On-device / Cloud) with a sliding thumb (spring). Offline: the Cloud segment is disabled with a lock/cloud-off icon and a one-line reason underneath.
- **Settings** (mic, language, tab audio, battery) collapse into a "Options" disclosure / bottom sheet. The hero stays uncluttered, as Pixel Recorder's redesign did.
- **Live transcript** card below or beside (lg). New words fade and unblur in over 200 ms. Auto-scroll with a "Jump to live" pill when the user scrolls up.
- **Floating recording pill** on other pages: glass, red live dot, mono timer, mini waveform (10 bars), and a tap to return.

### 6. Meeting list

- Header "Meetings" (24 px) plus a pill search field (48 px, `--surface-2`, search icon).
- Date sections with sticky small-caps labels ("TODAY", 12 px, tracking .08em, muted).
- Each card (22 radius, depth shadow, 16 px padding): title (16/600, 2 lines max), a meta row in mono/muted ("42:18 · 3 speakers · 2:14 PM"), a row of tiny speaker dots (colour stack, max 4), and a right-side status chip ("Minutes ready" accent-soft / "On this phone" warning-soft / "Syncing…" with spinner). Press: scale .98 with the surface lightened.
- Swipe actions are optional later. Long-press opens a bottom sheet (Share, Rename, Delete).

### 7. Meeting page

- Top bar: back chevron "Meetings", title (editable inline), overflow ⋯ (Rename, Delete).
- Header block: date and duration (mono), the speaker talk-time bar (8 px, rounded, segmented in speaker colours), and speaker chips (avatar initial in speaker colour, tap to rename sheet).
- **Primary action row**: `Share` (accent pill, full width on phones) plus `Copy` (secondary). "More formats" opens a sheet: PDF, Word, TXT, each as a row with icon, format name and a description ("Best for printing").
- Tabs (segmented, sliding thumb): **Minutes** | **Transcript**. With no minutes yet, the Minutes tab shows a generate card (model picker inside the card). Offline: the generate button is disabled with "Needs internet. We'll keep this meeting ready."
- Transcript: paragraphs with a 3 px left rule in the speaker colour, the speaker name in colour (13/600), the timestamp in mono muted, and reading text at 17 px/1.6.

### 8. Empty states

- **No meetings**: a centred illustration of the aurora orb (static gradient circle with the mic icon in a 64 px glass disc), "No meetings yet", "Record your first meeting. It works offline too.", and a primary pill "Start recording" that goes to `/`.
- **Recorder idle, first run**: under the button, "Tap to record · Works without internet on this phone" plus a ghost "Try a sample" (keep the existing sample).
- **No transcript yet (recording, silence)**: a "Listening…" shimmer (a gradient sweep across the text, 1.6 s linear infinite). After 8 s of no level, show the existing no-sound warning as a warning-soft notice with a haptic Warning.
- **Search no results**: "No meetings match 'xyz'" plus a "Clear search" ghost button.
- **Offline**: no full-screen error. A persistent small pill "Offline" (warning-soft, cloud-off icon) in the top bar that springs in and out.

### 9. Feedback components

- **Toast**: glass, bottom above the tab bar, slides up 12 px with spring, auto-dismisses after 2.5 s. Used for Copied, Exported, Back online, and Saved.
- **Bottom sheet** (phones) / centred dialog (lg): 22 radius top, drag handle, slides up 320 ms `--ease-in-out`, scrim `rgba(14,15,23,.4)`. Android back closes it first.

---

## MVP Definition (this milestone)

### Launch With

- [ ] `shareOrDownload` helper plus TXT / DOCX / real PDF via Capacitor Filesystem (Cache) and Share, and Web Share/anchor on the web. Fixes the broken core value "share in one tap".
- [ ] One-tap Share (text) and Copy on the meeting page.
- [ ] Online status hook, offline pill, and disabled-with-reason Cloud engine / AI minutes.
- [ ] Navigation: back chevron, brand goes home, Android back handler (sheet, back, root, minimize-if-recording / exit).
- [ ] Aurora Ink tokens (light and dark tinted), depth, Geist, and motion tokens in `globals.css`/`ui.tsx`.
- [ ] Recorder hero: orb, morphing record button, waveform, and haptics.
- [ ] Meeting list cards with date groups, status chips and the empty state.
- [ ] Speaker names map plus rename-applies-to-all, used in exports and minutes.

### Add After Validation

- [ ] Speaker merge, once diarization on-device is in and its errors are visible.
- [ ] Theme override toggle, plus "True black" if requested.
- [ ] View Transitions page animations, if Next 16 integration proves stable.
- [ ] Long-press / swipe actions on list cards.

### Future Consideration

- [ ] SRT/VTT export, share links (public web view of minutes), and voiceprint speaker recognition across meetings (Otter-style). These need server work and privacy design.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Export/share fix | HIGH | MEDIUM | P1 |
| Offline gating + indicator | HIGH | LOW | P1 |
| Navigation/back | HIGH | LOW | P1 |
| Design tokens + depth + tint | HIGH | LOW | P1 |
| Recorder hero motion + haptics | HIGH | MEDIUM | P1 |
| Speaker rename (all) | MEDIUM–HIGH | MEDIUM | P1 |
| Talk-time bar | MEDIUM | LOW | P2 |
| Word settle animation | MEDIUM | LOW | P2 |
| Speaker merge | MEDIUM | MEDIUM | P2 |
| View transitions | LOW–MEDIUM | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | Otter / Fireflies | Granola | Pixel Recorder | Our Approach |
|---------|-------------------|---------|----------------|--------------|
| Offline | No | No | Yes (on-device) | Yes, on-device engines plus a sync queue |
| Speaker labels | Cloud, rename-all | Limited | On-device, rename | Cloud (Deepgram) plus on-device diarization, rename-all |
| Summary | Yes, dense | Yes, highlights user notes | Yes (Gemini on Pixel) | Minutes/Report, gated online, queued |
| Share | Links, exports | Share link, copy | Share audio/text/link | Native sheet: text plus PDF/DOCX/TXT files |
| Visual tone | Busy SaaS | Calm paper | Expressive, big controls | Calm tinted surfaces plus one living recorder |

## Sources

- Capacitor App API (backButton, `canGoBack`, listener disables default, `disableBackButtonHandler`, `exitApp`, `minimizeApp`): https://capacitorjs.com/docs/apis/app (HIGH)
- Capacitor Haptics API (impact / notification / selection, no-op without vibrator): https://capacitorjs.com/docs/apis/haptics (HIGH)
- @capacitor/share 8.0.1 README (files are file:// URLs, Android shares only from cache by default): https://cdn.jsdelivr.net/npm/@capacitor/share@8.0.1/README.md (HIGH)
- Capacitor file handling guide (write to Cache, then getUri, then Share): https://capawesome.io/blog/capacitor-file-handling-guide/ (MEDIUM)
- Web Share not implemented in Android WebView: https://github.com/ionic-team/capacitor/discussions/3213 ; MDN https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share (MEDIUM, older sources, consistent)
- Pixel Recorder Material 3 Expressive redesign: https://9to5google.com/2025/08/23/pixel-recorder-material-3-expressive/ , https://www.androidauthority.com/pixel-recorder-expessive-redesign-out-now-3590800/ (MEDIUM)
- Material 3 Expressive overview: https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-supported-devices-3556392/ ; spring presets (library-reported, stiffness 380 / damping ~0.8): https://pub.dev/documentation/material_expressive/0.8.0/ (LOW–MEDIUM)
- Granola UI reviews: https://tldv.io/blog/granola-review/ , https://skillscouter.com/granola-review/ , https://intelligentinterfaces.substack.com/p/how-granola-enhances-note-taking (MEDIUM)
- Speaker rename-all patterns: https://support.grain.com/en/articles/9554871-how-to-change-speaker-names-in-a-transcript , https://help.reduct.video/en/articles/6640770-renaming-speakers , https://support.limecraft.com/support/solutions/articles/48001273748 (MEDIUM; Otter's exact UI not verified)
- Liquid Glass on the web (backdrop-filter limits, refraction Chromium-only, performance cautions): https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/ , https://www.buildmvpfast.com/blog/liquid-glass-css-backdrop-filter-recipes-2026 (MEDIUM)
- Motion LazyMotion / bundle size: https://motion.dev/docs/react-reduce-bundle-size (HIGH)
- Contrast ratios: computed locally (WCAG relative luminance formula).

---
*Feature research for: Transcriber redesign milestone*
*Researched: 2026-11-20*
