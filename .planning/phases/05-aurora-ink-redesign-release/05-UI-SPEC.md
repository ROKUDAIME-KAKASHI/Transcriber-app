---
phase: 5
slug: aurora-ink-redesign-release
status: approved
reviewed_at: 2026-11-23
shadcn_initialized: false
preset: none
created: 2026-11-23
---

# Phase 5 — UI Design Contract ("Aurora Ink")

> Visual and interaction contract for the restyle. Sources: 05-CONTEXT.md (D-01..D-21, locked), research/FEATURES.md "Design Direction - Aurora Ink" (spec), research/STACK.md "UI motion", existing code (`globals.css`, `ui.tsx`, `Recorder.tsx`, `AppShell.tsx`, `MeetingList.tsx`, `MeetingView.tsx`). Content, features, routes, export/share/sync/diarization logic do NOT change; only look, feel, motion.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | none (Tailwind v4 `@theme inline` tokens in `src/app/globals.css`; no shadcn; React project but CONTEXT locks "no component library") | CONTEXT D-02 |
| Preset | not applicable | — |
| Component library | none. Primitives in `src/components/ui.tsx` (Button, Panel, PanelHeader, Segmented, OptionList, Badge, LiveDot, Notice, GateReason) are restyled first; new files: `Orb.tsx`, `Waveform.tsx`, `Toast.tsx`, `src/lib/haptics.ts`, `src/lib/motionPref.ts` | CONTEXT D-02, Discretion |
| Icon library | `lucide-react` (existing). Stroke 2, sizes 16 (inline/buttons), 20 (tab bar, top bar), 28 (record button mic) | existing |
| Font | Geist Sans (UI + headings) + Geist Mono (timer, durations, timestamps, meta numbers) via `next/font/google`, variables `--font-geist-sans` / `--font-geist-mono`, `display: "swap"`, replaces Inter in `src/app/layout.tsx` | CONTEXT D-07 |
| New runtime deps | none. `tw-animate-css` and `motion` are NOT added (CSS covers every interaction below) | CONTEXT D-08 + Discretion |
| Theme switching | `prefers-color-scheme` only (no toggle) | CONTEXT D-02 |

Token names kept (so components compile): `background, card, muted, border, foreground, muted-foreground, accent, accent-foreground, danger, success, warning, speaker-0..5`. Added: `--surface-2` (alias of `--muted`), `--accent-soft`, `--record`, `--record-fill`, `--warning-soft`, `--success-soft`, `--danger-soft`, `--glow-a`, `--glow-b`, `--shadow-card`, `--shadow-float`, `--highlight`, `--glass`, motion tokens (below). Expose via `@theme inline` as `--color-accent-soft`, `--color-record`, `--color-record-fill`, `--color-warning-soft`, `--color-success-soft`, `--color-danger-soft`, `--font-mono`.

---

## Spacing Scale

Declared values (multiples of 4; Tailwind default 4 px step):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-label gaps inside chips, segmented track padding |
| sm | 8px | Gap between chips, button icon gap, meta row gap |
| md | 16px | Card padding (phone), list gap between cards (12 allowed: `gap-3`), page side padding (phone) |
| lg | 24px | Card padding (lg), section gap, page side padding (sm+) |
| xl | 32px | Hero card inner vertical padding, gap between hero and live transcript |
| 2xl | 48px | Empty-state vertical padding, page top padding (lg) |
| 3xl | 64px | Bottom padding above the floating tab bar (`pb-28` = 112 stays as reserved chrome clearance) |

Exceptions (fixed component sizes, all multiples of 4 except the waveform):
- Touch targets: min 44 px for icon buttons, min 48 px for primary/secondary buttons and the search field on touch (D-05).
- Record button 88 px; stop shape 72 px; pause/resume 56 px; bottom tab bar item min-height 56 px; recording pill height 48 px.
- Waveform bars 3 px wide, 3 px gap (FEATURES §5); transcript speaker rule 3 px. These are drawing sizes, not layout spacing.
- 12 px (`gap-3`, `py-3`) allowed for dense rows (list card gap, OptionList rows) as already used.

Radii (D-05): `--radius-chip: 10px` (chips, inputs, OptionList, Notice), `--radius-btn: 14px` (non-pill buttons, segmented thumb 10 inside 14 track), `--radius-panel: 22px` (cards, panels, sheets, hero), `rounded-full` (primary buttons, pills, record button, tab-bar active pill, toast).

---

## Typography

Two weights only: **400 regular** and **600 semibold**. Implement by setting `--font-weight-medium: 600` in `@theme` so every existing `font-medium` renders 600 with no class churn. Headings tracking `-0.015em`. Nothing below 13 px.

| Role | Size | Weight | Line Height | Font / Use |
|------|------|--------|-------------|-----------|
| Label / meta | 13px (`text-meta`) | 400 (meta), 600 (chips, field labels, tab labels, speaker names) | 1.4 (20px) | Sans; numbers in Mono + `tabular-nums` (durations, times, word count) |
| Body / UI | 15px (`text-ui`) | 400 (copy), 600 (buttons, card titles, panel titles) | 1.5 (22px) | Sans |
| Heading | 24px (`text-2xl`) | 600 | 1.2 | Sans; page titles "Meetings", meeting title, empty-state heading. Same at all widths (drop the old 28px `sm:` step) |
| Display | 56px | 400 | 1.0 | Geist Mono, `tabular-nums`, tracking -0.02em; Recorder timer only |

Exception (locked D-07): **Reading** text in TranscriptView and the Minutes article = 17px / 1.6 on phones (<640 px), 16px / 1.6 on sm+, weight 400. Card titles use Body 15/600 clamped to 2 lines (`line-clamp-2`). Date-group labels: 13/600 uppercase, tracking 0.08em, muted.

---

## Color

| Role | Light | Dark | Usage |
|------|-------|------|-------|
| Dominant (60%) `--background` | #F7F7FB | #0E0F17 | App canvas, plus fixed top radial tint `radial-gradient(1200px 600px at 50% -10%, color-mix(in oklab, var(--glow-a) 10%, transparent), transparent)` on `body` (background-attachment fixed) |
| Secondary (30%) `--card` | #FFFFFF | #171926 | Cards, panels, hero, sheets, sidebar, top bar, glass base |
| `--muted` / `--surface-2` | #EFF0F6 | #20233A | Inputs, segmented track, hover fills, skeletons |
| `--border` | #E2E4EE (used at 70%) | #2A2D44 | Hairlines on cards and inputs only |
| `--foreground` | #14151F | #EDEEF5 | Text (17.0 / 16.5 on bg) |
| `--muted-foreground` | #5B5F73 | #9A9DB3 | Meta text (5.9 / 7.1 on bg; >=5.5 on surface-2) |
| Accent (10%) `--accent` | #3651F5 | #8EA2FF | See reserved list |
| `--accent-foreground` | #FFFFFF (5.75) | #0E0F17 (8.0) | Text/icons on accent |
| `--accent-soft` | `color-mix(in oklab, var(--accent) 12%, var(--card))` ≈ #E6E9FE | `color-mix(in oklab, var(--accent) 16%, var(--card))` | Active nav pill, selected chip, "Minutes ready" chip bg (accent text on it: 4.8 light) |
| `--record` | #E5484D | #FF6369 | Live dot, live ring, "Recording" label, waveform peak — non-text graphics + 13/600 label in dark |
| `--record-fill` | #E5484D | #E5484D | Record/stop button fill in both themes (white icon 3.9:1 passes 3:1 non-text; #FF6369 with white would be 2.9 and fail) |
| Destructive `--danger` | #C9353B (5.2 on white, 4.8 on bg) | #FF6369 (6.6) | Delete meeting, "Couldn't sync", danger Notice. Light deviates from #E5484D only so text passes AA (D-20 overrides D-02 "danger = record") |
| `--success` | #1A7F5A | #3DD68C | "Synced", success Notice/Toast icon |
| `--warning` | #A15C00 | #F5B544 | Offline pill, "Paused", no-sound notice, "On this phone" chip |
| `--*-soft` (warning/success/danger) | `color-mix(in oklab, var(--x) 10%, var(--card))` — never above 10% in light (warning text on it = 4.55) | 16% | Soft chip/pill/Notice backgrounds; text always the solid token |
| `--glow-a` / `--glow-b` | #3651F5 / #14B8C4 at 18–30% alpha | #5B6CFF / #22D3EE at 22–35% alpha | Orb and page tint only |

Speaker palette (D-03, two light values darkened for AA as 13/600 text on white): Light `#3651F5, #0B7D70, #B25A08, #C23A72, #5A7A12, #7A5AF0`. Dark `#8EA2FF, #3CCFBC, #F4A955, #F483AE, #B0D163, #B39CFF`. Used for: chip avatar initial/ring, paragraph 3 px left rule, speaker-name text, talk-time segments.

Accent reserved for (exhaustive): primary pill buttons (Start recording on empty states, Share, Create/Regenerate minutes, Sign in), segmented-control active label colour + focus ring, active tab-bar/sidebar icon + `--accent-soft` pill, logo tile, links, `:focus-visible` outline (2 px, offset 2), text selection (22%), recent waveform bars, "Minutes ready" chip, "Jump to live" pill. NOT accent: secondary buttons, card borders, icons in meta rows, headings.

Record red reserved for: record/stop button, live dot, live ring, "Recording" label, recording pill dot. Never for decoration.

Depth (D-04):
- `--shadow-card` light: `0 1px 2px rgba(20,21,31,.04), 0 4px 16px -4px rgba(20,21,31,.06)`; dark: `inset 0 1px 0 rgba(255,255,255,.05), 0 8px 24px -8px rgba(0,0,0,.5)`. Applied by `Panel` and list cards with the hairline border.
- `--shadow-float`: `0 8px 32px -8px rgba(14,15,23,.18)` light / `0 12px 32px -8px rgba(0,0,0,.6)` dark (tab bar, pill, toast).
- Glass (`.glass` utility, floating chrome ONLY: bottom tab bar, recording pill, toast): `background: color-mix(in oklab, var(--card) 78%, transparent); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: same; border: 1px solid color-mix(in oklab, var(--border) 60%, transparent)`. `@supports not (backdrop-filter: blur(1px)) { background: var(--card) }`.
- `themeColor` (D-06): light #F7F7FB, dark #0E0F17 in `layout.tsx` viewport; manifest `background_color`/`theme_color` #0E0F17.

---

## Motion Contract (D-08..D-12)

Tokens in `:root`: `--dur-1: 120ms; --dur-2: 200ms; --dur-3: 320ms; --dur-4: 500ms; --ease-out: cubic-bezier(0.22,1,0.36,1); --ease-in-out: cubic-bezier(0.65,0,0.35,1); --spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121 24%, 1.129 26.3%, 1.12 28.7%, 1.088 32.4%, 1.019 42.8%, 0.995 49.8%, 0.992 57.7%, 1.001 82%, 1)`.

| Interaction | Spec |
|-------------|------|
| Press (Button, tab, chip, segmented) | `active:scale-[0.96]`, `transition: transform var(--dur-1) var(--ease-out), background-color/color var(--dur-1)`; cards `active:scale-[0.98]` |
| Page enter | `.page-enter` keyframe on the `AppShell` content wrapper keyed by pathname: opacity 0→1 + translateY(8px→0), 320 ms ease-out. No View Transitions |
| List stagger | Meeting cards: `fade-up` (opacity 0, y 6px → 0) 240 ms ease-out, `animation-delay: calc(min(var(--i), 8) * 30ms)`; index >= 8 no delay. Runs on first mount only |
| Segmented thumb (engine picker, Minutes/Transcript, Document type) | One absolutely positioned thumb `translateX(index * 100%)`, `transition: transform var(--dur-4) var(--spring)`; labels colour 200 ms |
| Toast / sheets | Toast in: translateY(12px)+opacity 0 → 0, 500 ms spring; out 200 ms ease-out. Sheets: slide up 320 ms ease-in-out, scrim fade 200 ms |
| Offline pill | Springs in/out: scale .9→1 + opacity, 500 ms spring |
| New transcript text | fade + blur(4px→0) 200 ms ease-out on newly appended paragraphs only (TranscriptView stays memoised) |
| Skeleton / "Listening…" | gradient sweep 1.6 s linear infinite |

Rules: animate only `transform`, `opacity`, `filter` on the orb, and colour on small elements. Mic visuals read `rec.micLevel` (~12/s); no new AnalyserNode, no per-frame React state. One rAF loop max (orb + waveform share it), writing CSS custom properties / transforms via refs, stopped when `document.hidden`, paused, calm mode, or reduced motion.

Reduced motion (D-10): existing `@media (prefers-reduced-motion: reduce)` kill switch stays and is duplicated as `html[data-motion="reduced"] *, …` with identical rules. In-app toggle "Reduce motion" (switch row in Recorder Options disclosure, persisted `localStorage["transcriber.motion"]`, applied in `Providers.tsx` before paint via inline script in `layout.tsx` to avoid a flash). Reduced: no orb scaling/breathe (static gradient at 25%), waveform replaced by a single static level bar (width = level, 200 ms colour only), live dot solid (no blink/ring), springs instant, no stagger, no page enter.

Haptics (D-11, `src/lib/haptics.ts`): `tap()` = ImpactStyle.Light on tab change; `start()`/`stop()` = ImpactStyle.Medium on record start/stop; `success()` = NotificationType.Success on copy/share done; `warn()` = NotificationType.Warning on no-sound. All guarded by `Capacitor.isPluginAvailable("Haptics")` + try/catch, return void, never throw; web no-op.

---

## Component Contracts

### Shell (AppShell, ConnectivityPill) — D-19
- Sidebar (lg, 240 px): `bg-card`, hairline right border, no glass. Nav item min-h 40, radius 14; active = `bg-accent-soft text-foreground`, icon `text-accent`; inactive muted with `hover:bg-muted`.
- Phone top bar: h 56, `bg-background/80` solid fallback card, hairline bottom border; logo + ConnectivityPill + sign-out (44 px).
- Logo: 28 px tile radius 10, `bg-accent text-accent-foreground`, AudioLines icon 16, wordmark 15/600.
- Bottom tab bar (phones): floating `.glass` pill bar, `fixed inset-x-4 bottom-[calc(12px+safe-area)]`, radius full, h 64, `--shadow-float`, max-w 448 centred. Items min-h 56; active item gets a `bg-accent-soft` pill behind icon + label (spring in), icon 20 `text-accent`, label 13/600; inactive muted. Content bottom padding stays `pb-28`.
- ConnectivityPill offline: `bg-warning-soft text-warning`, CloudOff 14, 13/600, h 28, radius full, springs in/out. Copy unchanged.
- Recording pill (D-15, existing Recorder L~520-550 markup restyled; shown on non-Record routes while recording): `.glass`, h 48, radius full, `--shadow-float`, sits 12 px above the tab bar (phones) / bottom-right 24 px (lg). Content: live dot, mono 15/600 timer, mini 10-bar waveform (reduced: static bar), pause/resume + stop 40 px icon buttons. Tap body → `/`.

### Primitives (ui.tsx)
- Button: radius 14 for `secondary/ghost/danger`; `primary` and `danger-solid` = `rounded-full`. Heights: md `min-h-12 lg:min-h-10`, lg `min-h-12`. primary `bg-accent text-accent-foreground hover:bg-accent/90 shadow-[0_4px_14px_-6px_var(--accent)]`; secondary `bg-card border-border/70 shadow-card hover:bg-muted`; danger-solid `bg-danger text-white` (light #C9353B passes). Press scale + 120 ms. Disabled opacity 50 and no press scale.
- Panel: radius 22, `bg-card`, hairline `border-border/70` (dark full), `--shadow-card`.
- Segmented: track `bg-muted` radius 14 p-1; sliding thumb `bg-card shadow-card` radius 10; active label `text-foreground` 600; disabled segment shows lock/cloud-off icon 14 + `GateReason` below (unchanged logic).
- Badge (chips): radius full, h 24, px 8, 13/600; tones neutral (`bg-muted text-muted-foreground`), accent (`bg-accent-soft text-accent`), success/warning/danger (`bg-*-soft text-*`), live (`bg-danger-soft text-record` + LiveDot).
- Notice: radius 10, soft tone bg + 1 px tone/30 border; add `warning` tone.
- Inputs/selects: radius 10, `bg-muted` (no border at rest, `focus:ring-2 ring-accent`), min-h 48 on touch, `.select` chevron stroke uses muted colour per theme.

### Record screen (Recorder.tsx) — D-13, D-14
Layout: phones single column, hero first; lg two columns (hero 5/12 sticky, live transcript 7/12) as today.
- Hero card: Panel radius 22, min-h `min(560px, 70dvh)` on phones, centred column, `overflow-hidden`, `py-8 px-6`.
- Order top→bottom: state row (live dot + "Recording" 13/600 `text-record`, blinking 1 Hz opacity 1↔.35; "Paused" `text-warning` no blink; "Ready" muted) → timer 56 mono → orb + button stack (orb 280 px absolutely centred behind the 88 px button) → waveform (h 48, 56 bars) → status line 13 muted → engine Segmented → "Options" disclosure.
- Orb (`Orb.tsx`, `aria-hidden`): two radial gradients (`--glow-a` at 30% 40%, `--glow-b` at 70% 60%), `filter: blur(40px)`, `will-change: transform, opacity`. Recording: scale `1 + L*0.35`, opacity `0.35 + L*0.5`, L = lerp(prev, micLevel, 0.15) per frame. Idle: `orb-breathe` 4 s ease-in-out infinite scale .96↔1.04 at opacity .25. Paused: frozen at .25.
- Record button: 88 px circle `bg-record-fill`, white Mic 28, outer ring `0 0 0 6px color-mix(record-fill 20%, transparent)`. On start: width/height via `transform: scale(72/88)` + `border-radius 44px→22px` over 500 ms spring into stop (white Square 24 icon); live ring pseudo-element scale 1→1.35, opacity .45→0, 1.6 s ease-out infinite. aria-labels unchanged ("Start recording" / "Stop recording"). Haptic start/stop.
- Pause/Resume: 56 px circle secondary (`bg-card shadow-card`), slides in from behind the main button `translateX(-72px)` (left) with spring; stop stays centred. Getting-ready state: button shows Loader2 spinner, ghost "Cancel" below (existing).
- Waveform (`Waveform.tsx`, `role="meter"` aria as current LevelMeter): 56 bars, 3 px wide, 3 px gap, radius 2, height `max(4px, level*48px)`, ring-buffer shifted left each micLevel tick (transform on a single track, no layout per bar beyond height on the newest). Newest 12 bars `--accent`, older fade to `--muted-foreground` at 40%. Hidden when not recording (idle shows the empty-state hint instead).
- Calm mode (D-14): enters after 10 min continuous recording OR battery-saver option on; also while `document.hidden`. Orb freezes at static 25%, waveform replaced by static level bar (h 4, w 160, radius full, fill width = level, colour transition only), live dot solid. Shows 13 muted line "Calm mode saves battery. Tap to show the animation." Tap on hero → animation for 60 s, then calm again. Transcript card unaffected.
- Options disclosure: Button ghost "Options" with ChevronDown (rotates 180° 200 ms), collapsed by default; contains existing Language, Microphone, tab-audio toggle, battery Notices, and the new "Reduce motion" switch row. Battery-warning Notice stays visible outside the disclosure when the fix is needed (it is an action, not a setting).
- Live transcript card: Panel with PanelHeader "Transcript"; new paragraphs fade-in 200 ms; "Jump to live" accent pill (h 36, bottom-centre, spring in) when user scrolls up.
- No-sound warning: existing Notice becomes `warning` tone + haptic warn; copy unchanged.

### Meetings list (MeetingList.tsx) — D-16
- Header: "Meetings" 24/600 + subline 13 muted (existing copy); lg shows primary pill "New recording" (existing link). Existing search field kept: pill, h 48, `bg-muted`, Search icon 16 at left 16.
- Date groups: "Today", "Yesterday", "This week", "Earlier" (replaces weekday/date labels), 13/600 uppercase tracking .08em muted, `sticky top-14 lg:top-0` with `bg-background/90`.
- Cards (each `li` is its own card, gap 12, replacing the divided list): Link, radius 22, `bg-card shadow-card`, hairline, p-16 (lg p-20), `active:scale-[0.98]`, hover `bg-muted/40`, staggered enter. Grid: left column title 15/600 `line-clamp-2`, meta row 13 Mono muted `42:18 · 2:14 PM · Pixel 7` (duration · time · device name truncate; speaker count added only if the local row already carries it; device icon dropped); right column status chip top-aligned + ChevronRight 16 muted (lg).
- Status chip (one primary + optional sync chip, existing data only): RECORDING → live "Live"; template → accent "Minutes ready" / "Report ready"; else neutral "Transcript". Sync: pending → warning "On this phone"; pending while `sync.state === "syncing"` → neutral "Syncing…" with 12 px spinner; error → danger "Couldn't sync".
- Skeleton: 3 card-shaped blocks h 88 radius 22 `bg-muted` with sweep shimmer.
- Empty state: centred in a Panel, `py-12`: orb illustration (static 160 px gradient circle at 35% + 64 px glass disc with Mic 28 `text-accent`), heading 24/600, body 15 muted max 40ch, primary pill "Start recording" → `/`.
- Search no results: 15 muted text + ghost "Clear search" button (sets query "").
- Storage-blocked state: same empty layout without orb, existing copy.

### Meeting page (MeetingView.tsx) — D-17
- Top: back chevron button 44 px "Meetings" (13/600 muted, existing `aria-label`), title 24/600 inline-editable (existing), meta row Mono 13 muted (date · duration · words), speaker chips row (existing SpeakerChip/RenameSpeakerSheet restyled: radius full, h 32, 20 px avatar initial in speaker colour on `color-mix(speaker 16%, card)`).
- Action row: **Share** = primary pill full width on phones (lg: auto width, min 200), Share2 icon, label "Share", opens existing ShareMenu; **Copy** = secondary pill (Copy icon, "Copy"), side-by-side on lg, below Share on phones in a 2-col row with nothing else. PDF / Word / Text: kept as a compact row of three secondary buttons (radius 14, min-h 44) under a 13/600 muted label "More formats", same handlers, loading and disabled logic untouched. No export logic changes.
- Tabs: Segmented (role tablist semantics kept: `role="tab"`, `aria-selected`) "Minutes | Transcript" (label "Report" when template is Report), sliding thumb, max-w 320. Default Minutes when a document exists, else Transcript (existing logic). Haptic tap on change. Content cross-fades 200 ms.
- Minutes tab without doc: generate card (Panel, PanelHeader "Create with AI") with Document Segmented + Model OptionList + primary pill "Create minutes"/"Create report"; offline → disabled with GateReason "Needs internet. We'll keep this meeting ready." Existing busy/status strings unchanged. With doc: article (prose, 17/1.6 phones) then a collapsed "Regenerate with AI" card.
- Transcript: paragraphs with 3 px left rule `border-l-[3px]` in speaker colour, `pl-12`, speaker name 13/600 in speaker colour, timestamp Mono 13 muted, text 17/1.6 phones / 16/1.6 sm+. Gap 16 between paragraphs.
- Delete: danger ghost button at page bottom, two-tap confirm (unchanged).

### Toast (Toast.tsx, provider in Providers.tsx) — D-18
- `role="status" aria-live="polite"`, one at a time (new replaces old), `.glass` radius full, h 44, px 16, 15/600, leading icon 16 in tone colour (success CheckCircle2, warning CloudOff, danger AlertCircle). Position: fixed bottom-centre 12 px above the tab bar (phones), bottom 24 px centred in content (lg). Auto-dismiss 2.5 s; spring in. API `toast(text, tone?)`.
- Replaces only transient success messages (export success, copy success, back online, synced). Error `exportNote`s and all inline errors stay inline.

### Other screens
- Login (`app/login/page.tsx`) and Offline (`app/offline/page.tsx`): page tint + centred Panel, logo tile, primary pill CTA; copy unchanged.
- UpdateNotice: Notice accent-soft, copy unchanged.

---

## Copywriting Contract

Existing copy is kept unless listed. New/changed strings:

| Element | Copy |
|---------|------|
| Primary CTA (Record) | "Start recording" (aria-label on the 88 px button; no visible label) |
| Primary CTA (Meeting page) | "Share" |
| Secondary CTA (Meeting page) | "Copy" |
| Formats label | "More formats" (buttons "PDF", "Word", "Text" unchanged) |
| Tabs | "Minutes" / "Report" · "Transcript" |
| Recorder idle hint | "Tap to record · Works without internet on this phone" |
| Recorder state labels | "Ready" · "Getting ready" · "Recording" · "Paused" (existing) |
| Calm mode note | "Calm mode saves battery. Tap to show the animation." |
| Options disclosure | "Options" |
| Reduce motion toggle | "Reduce motion" / description "Fewer animations. Saves a little battery." |
| Jump pill | "Jump to live" |
| Empty state heading (list) | "No meetings yet" |
| Empty state body (list) | "Record your first meeting. It works offline too." + pill "Start recording" |
| Search empty | "No meetings match “{query}”" + ghost "Clear search" |
| Live transcript empty | "Listening…" (recording) / "No transcript yet" (idle), existing bodies kept |
| Status chips | "Live" · "Minutes ready" · "Report ready" · "Transcript" · "On this phone" · "Syncing…" · "Couldn't sync" |
| Offline gate (AI) | "Needs internet. We'll keep this meeting ready." |
| Toasts | "Copied to clipboard" · "Shared" · "Saved {PDF/Word file/text file}" · "Back online" · "Synced" |
| Error state (examples kept verbatim) | "Couldn't make the PDF. Try Word or Text instead." · "Couldn't open the share sheet. Try Copy text instead." · "Couldn't rename the meeting. Check your connection and try again." |
| Destructive confirmation | Delete meeting: first tap "Delete meeting" → button turns danger-solid "Tap again to delete" for 4 s (existing two-tap, no modal) |

Voice: plain, short, second person, no exclamation marks, sentence case.

---

## Accessibility

- Contrast pairs above are AA for text (>=4.5) in both themes; non-text graphics >=3:1 (record-fill vs bg 4.8 dark; white icon on record-fill 3.9).
- Focus: 2 px `--accent` `:focus-visible` outline on everything, including cards and segmented thumbs; never removed.
- Touch targets >=44 px; primary/secondary >=48 px on touch.
- `aria-live` toast; waveform `role="meter"` with `aria-valuenow`; orb and decorative glow `aria-hidden`; tab semantics preserved; live state conveyed by text ("Recording"/"Paused"), not colour alone.
- Verify at 375–390 px and >=1280 px, light and dark, on `npm run build && npm start` (port 3001) (D-20).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none (no shadcn, no third-party registry) | none | not applicable |

New npm runtime dependencies: none (fonts via `next/font/google`, self-hosted at build, COEP-safe).

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** pending
