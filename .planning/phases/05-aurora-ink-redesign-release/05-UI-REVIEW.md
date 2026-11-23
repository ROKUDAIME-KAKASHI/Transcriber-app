# Phase 5 — UI Review (Aurora Ink)

**Audited:** 2026-11-23
**Baseline:** 05-UI-SPEC.md (approved) + 05-CONTEXT.md
**Screenshots:** Not captured by this audit (code-only). Orchestrator evidence: /login at 390 px, dark and light, renders correctly (tinted ink, pill accent button, soft-depth card). Authenticated screens (Record, Meetings, Meeting, Share sheet, Toast, pill) were NOT visually verified; every finding below on those screens is from code only and needs a device pass.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Contract strings match nearly verbatim; "Try with sample audio" dev affordance ships in the hero; calm-mode copy diverges |
| 2. Visuals | 3/4 | Hierarchy, orb/waveform/stack all implemented; RecordingPill lacks pause/stop; waveform gap 2 px vs 3 px |
| 3. Color | 3/4 | Token system and accent discipline are strong; idle timer, Switch-off track and radio ring fail non-text/large-text contrast in light |
| 4. Typography | 3/4 | Two weights enforced via `--font-weight-medium: 600`; stray `text-base/lg/xl/[2rem]` and `text-[13px]` bypass the scale |
| 5. Spacing | 3/4 | Mostly 4 px grid; half-step values (10/14 px) used widely, including in the shared PanelHeader; non-token radii remain |
| 6. Experience Design | 3/4 | Reduced motion, calm mode, two-tap delete, offline gating, aria semantics all present; toast offset and pill controls deviate |

**Overall: 18/24**

Nothing scored 1, so no BLOCKER-class defect found by code review. Everything below is WARNING.

---

## Top 3 Priority Fixes

1. **Switch "off" track and idle timer fail contrast in light mode** — `ui.tsx:384` uses `bg-border` (#E2E4EE) for the off track on a `bg-card` (#FFF) row, about 1.3:1 against a required 3:1 for a UI component boundary, so the Reduce motion switch (and any other Switch) reads as "no control" on phones in light mode. `Recorder.tsx:366` renders the 56 px idle timer at `text-muted-foreground/60`, about 2.6:1 on white (needs 3:1 for large text). Fix: off track = `bg-muted-foreground/45` (or `border-2 border-muted-foreground/50`), idle timer = plain `text-muted-foreground` (5.9:1) and rely on size for de-emphasis. Same 3:1 problem, smaller: radio ring `border-muted-foreground/50` in `OptionList` (`ui.tsx:218`).
2. **RecordingPill omits pause/stop and is not a spec-conformant D-15 pill** — `RecordingPill.tsx` is a single `<Link>` with dot, timer, waveform. UI-SPEC "Recording pill" requires 40 px pause/resume and stop buttons, body tap to `/`. Users in another tab of the app have to navigate back to stop. Fix: render the pill as a container with the Link body plus two 40 px icon buttons wired to the native service pause/stop (the Recorder's phone bar already has the markup at `Recorder.tsx:735-761`; extract one shared `RecordingBar`). Note also that bar there is hidden on `lg` while the spec places the pill bottom-right on desktop.
3. **Off-scale type and radii leak past the tokens** — 5x `text-[13px]` (`Recorder.tsx:349,435,443,455,508`) duplicates `text-meta`; `text-base` x5, `text-lg` x2 (`AuthGate.tsx:84`), `text-xl` x2 and `text-[2rem]` (`login/page.tsx:76`, not in the 13/15/17/24/56 scale and contradicts "Heading 24 at all widths"); `rounded-lg`/`rounded-xl` at `AppShell.tsx:125,144`, `MeetingLoader.tsx:63`, `MeetingView.tsx:522`, `TranscriptView.tsx:178,198` instead of `rounded-btn`/`rounded-chip`. Fix: replace with `text-meta`, `text-2xl`, `rounded-btn`; define `prose-h1/h2` sizes from the scale (`MeetingView.tsx:671`).

### Further fixes (6+ issues exist)

4. Toast on phones is fixed at `bottom: 144px + safe-area` (`Toast.tsx:62`) regardless of whether a pill or bar is present; spec says 12 px above the tab bar (tab bar top is about 76 px). Result: toast floats about 68 px above the nav with nothing under it in the common case. Make the offset conditional on pill/bar presence or lower it to about 88 px and stack above the pill when shown.
5. Minutes article uses `prose prose-stone` + `dark:prose-invert` (`MeetingView.tsx:671`). Typography plugin colours (stone greys, link blue) do not use `--foreground` / `--accent`, so the hero reading surface is the one place that is not Aurora-tinted, and links will not be accent. Override via `--tw-prose-body/headings/links/...` set to the tokens.
6. "Try with sample audio" ghost button is shown in the main hero for every non-native visitor (`Recorder.tsx:462-466`), competing with the primary action and reading as a debug control. Move into Options or gate behind a dev flag.
7. Waveform bar gap is 2 px (`Waveform.tsx:75` `gap-[2px]`); spec is 3 px bars with 3 px gap.
8. Half-step spacing (px-3.5, py-3.5, gap-2.5, px-2.5, mt-0.5) is on the shared primitives (`PanelHeader` `px-5 py-3.5`, `inputCls px-3.5`, `Notice px-3.5 py-3`), so off-grid values (10/14 px) propagate everywhere. Move to 12/16.
9. Calm mode copy deviates: spec "Tap to show the animation." and hero tap-to-boost; implementation uses an inline "Show animation" text button plus hero tap (`Recorder.tsx:442-453`). The button is the better a11y choice (WR-05) but is a known copy deviation; record it in the contract or update UI-SPEC.
10. Waveform on `lg` desktop hero and Orb reach 60+ fps on the main thread? The orb itself is throttled to ~30 fps (`Orb.tsx` `FRAME_MS = 33`) with a 40 px blur on a 280 px layer; `filter: blur(40px)` re-rasterises on scale. Verify frame cost on the Xiaomi test phone; fall back to a pre-blurred radial gradient (no `filter`) if it janks. Not verifiable without a device.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- All contract strings present: "Start recording", "Share", "Copy", "More formats", "Options", "Reduce motion" + description, "Jump to live", "No meetings yet", "Record your first meeting. It works offline too.", "Clear search", "Listening…"/"No transcript yet", status chips, "Needs internet…", toasts "Copied to clipboard"/"Shared"/"Saved PDF|Word file|text file", "Tap again to delete" (`Recorder.tsx:436,449,671-716`, `MeetingList.tsx:36-48,176-206`, `MeetingView.tsx:333,368,418,634`).
- Idle hint "Tap to record · Works without internet on this phone" only shows when `onDevice && inApp`; plain web gets "Tap to record" (reasonable, but a divergence).
- WARNING: "Try with sample audio" in hero (see fix 6). "Close share menu" mobile button is fine and specific.
- WARNING: Saved-state strings in the transcript header ("Saved on this device · {syncNote}", "Offline · will retry") are long for the meta slot at 390 px; will wrap/truncate. Not verifiable without screenshots.
- Login (screenshot-verified) and Offline copy unchanged per spec.

### Pillar 2: Visuals (3/4)
- Implemented as specified: hero card with state row, 56 px mono timer, 280 px Orb behind 88 px record button morphing to 72 px rounded-square stop (`Recorder.tsx:403-407`), 56 px pause button sliding in, live ring, Waveform with 12 hot bars, date-grouped card list, glass tab bar, empty-state orb illustration, Share-primary / Copy-secondary hierarchy, sliding Segmented thumb.
- Icon-only buttons all have aria-labels (pause/resume, stop, sign out, back, title save/cancel).
- WARNING: RecordingPill has no pause/stop (fix 2). WARNING: waveform gap (fix 7). WARNING: top bar uses `bg-background/80` with no blur, so scrolled content ghosts through behind the logo; spec allowed "solid fallback card". Use `bg-background/90` or add `backdrop-blur`.
- Desktop sidebar nav icons are 16 px (`AppShell.tsx:108`) vs spec 20 px for nav; minor.
- Not verified visually: orb legibility behind the record button in light mode (glow alpha .3 over #FFF card may be nearly invisible; spec accepts it).

### Pillar 3: Color (3/4)
- Tokens match spec hex values in both themes (`globals.css:11-91`); `--record` light deviates to #C9353B deliberately for AA. Speaker palette matches. Soft tones use 10%/16% mix.
- Hardcoded hex only in `api/icons/[size]/route.tsx` and `layout.tsx` themeColor (both expected). No hex/rgb in components.
- Accent use is within the reserved list: primary buttons, segmented focus, active nav, logo tile, links, "Jump to live", recent waveform bars, "Minutes ready". `text-record` only on Recorder state label and live badge/dot. Good 60/30/10 discipline.
- WARNING (fix 1): `text-muted-foreground/60` idle timer (`Recorder.tsx:366`), Switch off track `bg-border` (`ui.tsx:384`), radio ring `/50` (`ui.tsx:218`). `Waveform` old bars `/40` are decorative, acceptable.
- WARNING (fix 5): prose colours not tokenised.
- `bg-white` knob in Switch and `text-white` on record/danger-solid are fixed-by-contract.

### Pillar 4: Typography (3/4)
- Distribution (components + app): text-meta 62, text-ui 41, text-reading 5, text-2xl 5, text-display 3. Weights: font-semibold 49, font-medium 12 (renders 600 via token), font-normal 1 (timer). Two effective weights: compliant.
- Reading text 17/1.6 phones, 16 sm+ with `max-w-[68ch]` in TranscriptView (`:252,261`) is per D-07.
- WARNING (fix 3): leakage `text-base` x5 (`inputCls` uses `text-base sm:text-ui`, which is intentional to stop iOS zoom and acceptable; the others are not), `text-lg` x2, `text-xl` x2, `text-[2rem]` on login heading; five hard-coded `text-[13px]`.
- Login `text-[2rem]` (32 px) is outside the declared scale; the verified screenshot looks right but the contract says headings are 24.
- `prose-h1:text-lg prose-h2:text-base` set Minutes headings to 18/16, below the 24 heading role and not in scale.

### Pillar 5: Spacing (3/4)
- Cards `p-4 lg:p-5`, list `gap-3`, hero `py-8 px-6`, `pb-28` content clearance, 12 px tab-bar offset, 88 px pill offset: as specified. Touch targets: buttons `min-h-12`, icon buttons 44, pause 56, record 88, tab items 56.
- Half-step counts: gap-1.5 x9, gap-2.5 x5, px-3.5 x4, px-2.5 x3, py-3.5 x2, px-1.5 x2, mt-1.5 x2. Spec scale is multiples of 4 (12 explicitly allowed). 10/14 px values are on shared primitives (fix 8).
- `px-5` x10 (20 px) and `py-5`/`pt-5`/`mt-5` are also off the 4/8/16/24 named scale (20 is a multiple of 4 but not a declared token).
- Arbitrary values are limited to fixed sizes (`h-[280px]`, `-ml-[124px]`, `h-[88px]`, `max-w-[320px]`); `-ml-[124px] -mt-7` hand-positions the pause button relative to the record button and will drift if either size changes. Prefer a flex row with a transform.
- Border-radius: `rounded-lg`/`rounded-xl` stragglers (fix 3).

### Pillar 6: Experience Design (3/4)
- Coverage present: skeleton cards with shimmer, "Loading your meetings" sr-only status, storage-blocked state, empty and search-empty states, offline gating with `GateReason` (`aria-describedby` wired on the record button), disabled/loading buttons, two-tap delete with 4 s revert, battery-warning Notice kept outside Options, no-sound `role="alert"` warning, Switch with `role="switch"`, Segmented with arrow-key/Home/End roving focus and tab semantics, ShareMenu as menu on desktop and `role="dialog"` sheet on phones with Escape and overlay-back handling, focus restore.
- Motion safety: `prefers-reduced-motion` and `html[data-motion="reduced"]` kill switches, spinners kept running, Orb and Waveform stop when reduced/hidden/calm, Waveform clears history when reduced, one rAF loop (Orb) plus a 100 ms interval (Waveform), calm mode with 60 s boost.
- WARNING: aria-modal sheet has no focus trap (focus can tab into the page behind it on phone). WARNING: ShareMenu desktop popover and sheet have no exit animation when `open` flips to false for the desktop branch (`if (!open) return null`); spec calls for 200 ms out.
- WARNING: toast offset (fix 4); toasts are only `polite` status, and error `exportNote` stays inline with `role="alert"` as specified (good).
- WARNING: `Switch` row is a clickable `div` with an inner button: pointer users get a larger target but the row has no keyboard/role of its own (acceptable since the inner button is focusable), and its off-state contrast fails (fix 1).
- Unverified without device: Android back-button over the sheet, safe-area insets on the floating tab bar, `backdrop-filter` cost on the Xiaomi test phone.

---

## Registry Safety
Skipped: no `components.json`, no third-party registries (UI-SPEC confirms).

## Files Audited
- `src/app/globals.css`
- `src/components/ui.tsx`, `AppShell.tsx`, `Recorder.tsx`, `Orb.tsx`, `Waveform.tsx`, `MeetingList.tsx`, `MeetingView.tsx` (actions/tabs region), `TranscriptView.tsx` (grep), `ShareMenu.tsx`, `Toast.tsx`, `RecordingPill.tsx`
- Repo-wide greps over `src/components` and `src/app` for type sizes, weights, hex colours, arbitrary values, half-step spacing, radii.
