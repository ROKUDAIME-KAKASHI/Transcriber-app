---
phase: 05-aurora-ink-redesign-release
fixed_at: 2026-11-23T00:00:00Z
review_path: .planning/phases/05-aurora-ink-redesign-release/05-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Source review:** 05-REVIEW.md (WR-01..WR-08; Info out of scope)
**Gate after fixes:** typecheck clean, 169/169 tests pass, `npm run build` succeeds.
**Note:** fixes were committed directly on `main` (no separate worktree) because the caller ran synchronously.

## Fixed Issues

### WR-01: Switch has no accessible name
**Commit:** 75d81d4 — `src/components/ui.tsx`. Label/description spans get `useId` ids; the switch button uses `aria-labelledby` / `aria-describedby`.

### WR-02: `text-record` fails AA in light theme
**Commit:** 7751285 — `src/app/globals.css`, `tests/contrast.test.ts`. Light `--record` changed to `#c9353b` (the record button fill `--record-fill` is unchanged). Added a "record text passes AA" test against card, background and muted in both themes.

### WR-03: Reduced-motion freezes spinners
**Commit:** 4f430a5 — `src/app/globals.css`. `.animate-spin` is exempted (1.2s, infinite) under both the media query and `html[data-motion="reduced"]`.

### WR-04: Segmented keyboard/ARIA gaps
**Commit:** b52657f — `src/components/ui.tsx`, `src/components/MeetingView.tsx`. Arrow/Home/End navigation (skips disabled options), roving tabindex, and the meeting tab content is now a `role="tabpanel"` labelled by the active tab, with `aria-controls` on the tabs.

### WR-05: Calm mode exit not keyboard operable
**Commit:** a270fc3 — `src/components/Recorder.tsx`. The hint now has a real "Show animation" button; area click kept.

### WR-06: ShareMenu menu/modal structure
**Commit:** 2ffd533 — `src/components/ShareMenu.tsx`. On phones the sheet is `role="dialog" aria-modal="true"`, the Close button sits outside the `role="menu"` element, and focus restore to the anchor is its own effect keyed on `open` (no longer fires when `desktop` flips). A full focus trap / `inert` on the page was deliberately not added (larger behavioural change); `aria-modal` plus the backdrop and Escape/Android-back handling remain.

### WR-07: Waveform ring buffer
**Commit:** b44a138 — `src/components/Waveform.tsx`. Samples on a fixed 100 ms cadence from the latest level (ref), so the axis is uniform and paused/silent input scrolls out; history is cleared when `reduced` turns on.

### WR-08: Toast overlaps phone recording bar
**Commit:** 9ee511e — `src/components/Toast.tsx`. Mobile toast offset raised from 88px to 144px (above the 48px bar/pill) rather than a conditional CSS variable; desktop offset unchanged.

## Skipped Issues

None.

---

_Fixer: Claude (gsd-code-fixer)_
