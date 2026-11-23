---
phase: 05-aurora-ink-redesign-release
reviewed: 2026-11-23T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - src/app/api/icons/[size]/route.tsx
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/login/page.tsx
  - src/app/manifest.ts
  - src/app/offline/page.tsx
  - src/components/AppShell.tsx
  - src/components/ConnectivityPill.tsx
  - src/components/MeetingList.tsx
  - src/components/MeetingLoader.tsx
  - src/components/MeetingView.tsx
  - src/components/Orb.tsx
  - src/components/Providers.tsx
  - src/components/Recorder.tsx
  - src/components/RecordingPill.tsx
  - src/components/RenameSpeakerSheet.tsx
  - src/components/ShareMenu.tsx
  - src/components/SpeakerChip.tsx
  - src/components/Toast.tsx
  - src/components/TranscriptView.tsx
  - src/components/UpdateNotice.tsx
  - src/components/Waveform.tsx
  - src/components/ui.tsx
  - src/hooks/useBackgroundRecording.ts
  - src/lib/calmMode.ts
  - src/lib/dateGroup.ts
  - src/lib/haptics.ts
  - src/lib/motionPref.ts
  - tests/calmMode.test.ts
  - tests/contrast.test.ts
  - tests/dateGroup.test.ts
findings:
  critical: 0
  warning: 8
  info: 6
  total: 14
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-11-23
**Depth:** standard (cross-file on Recorder / Orb / Waveform / calmMode / useBackgroundRecording / MeetingView / ShareMenu)
**Files Reviewed:** 31
**Status:** issues_found

## Summary

No behaviour regressions found in recording, export/share, sync or diarization paths. Recorder control wiring, ShareMenu logic and MeetingView share/export handlers are unchanged apart from added toasts and haptics. Haptics is correctly guarded (`hasPlugin` plus a swallowed dynamic import), so old APKs are safe. The pre-paint script, `useSyncExternalStore` server snapshots and `suppressHydrationWarning` are sound. The Orb loop is cleaned up and visibility-aware, and writes only transform/opacity through a ref at 30 fps.

The main problems are accessibility and contrast. The new `Switch` has no accessible name. The "live" red text fails AA in light theme and is not covered by the contrast test. Reduced-motion CSS freezes spinners. The Segmented control and ShareMenu have ARIA/keyboard gaps. Calm mode's "tap to show" has no keyboard path. There are also a few minor correctness and robustness issues in Waveform and ShareMenu.

## Warnings

### WR-01: Switch has no accessible name

**File:** `src/components/ui.tsx:350-364`
**Issue:** The `role="switch"` button has no `aria-label` or `aria-labelledby`. The label and description are sibling `<span>`s inside a clickable `<div>`, not a `<label>`. Screen readers announce "switch, off" with no name, so the "Reduce motion" control (the only in-app motion opt-out) is unidentifiable to them. The `id` prop is also never tied to anything.
**Fix:** Give the label span an id and reference it.
```tsx
const labelId = useId();
<span id={labelId} className="block text-ui font-semibold">{label}</span>
{description && <span id={`${labelId}-d`} ...>{description}</span>}
<button role="switch" aria-labelledby={labelId} aria-describedby={description ? `${labelId}-d` : undefined} ...>
```

### WR-02: `text-record` fails AA contrast in light theme, and the contrast test does not cover it

**File:** `src/components/Recorder.tsx:354,357`, `src/components/ui.tsx:247` (Badge live); tokens in `src/app/globals.css:20`
**Issue:** `--record: #e5484d` on white or card is about 3.9:1, and lower on `bg-danger-soft` (the Badge "Live" case). That is below the 4.5:1 AA minimum for the 13px semibold "Recording" label and the "Live" badge. `tests/contrast.test.ts` only checks `record-fill` against a white glyph (3:1) and does not test `record` text pairs, so the gap is invisible to the gate. Dark theme (`#ff6369`) is fine.
**Fix:** Use a darker light-theme `--record` text token (for example `#c9353b` or `#cf2f36`), or render these labels in `--danger`. Add `check(t, "record", "card", 4.5)` and `check(t, "record", "danger-soft"-equivalent)` to the contrast test.

### WR-03: Reduced-motion CSS freezes every spinner

**File:** `src/app/globals.css:336-352`
**Issue:** The reduce-motion rules force `animation-duration: 0.001ms` and `animation-iteration-count: 1` on `*`. Every `animate-spin` Loader2 (Recorder "starting", `Button loading`, "Saving") becomes a static icon, so busy state has no motion feedback. A user who opted out of motion sees a button that looks idle while "Preparing…" or "Saving". This is a behaviour regression for those users vs. the pre-phase UI.
**Fix:** Exempt progress indicators from the blanket override.
```css
html[data-motion="reduced"] .animate-spin { animation-duration: 1.2s !important; animation-iteration-count: infinite !important; }
```
Do the same inside the media query, or replace the spinner under reduce with a non-motion cue (text "Saving…").

### WR-04: Segmented control lacks arrow-key navigation and roving tabindex

**File:** `src/components/ui.tsx:108-157`
**Issue:** It declares `role="radiogroup"` / `role="tablist"`, but every option is a separate tab stop and arrow keys do nothing. Both ARIA patterns require arrow-key movement with a single tab stop. With `semantics="tabs"` (MeetingView) there is also no `role="tabpanel"` or `aria-labelledby` on the content (`MeetingView` `<div key={tab} ...>`). `aria-controls` is optional and unused there. Keyboard and screen-reader users get misleading semantics.
**Fix:** Add an `onKeyDown` on the group handling ArrowLeft/Right/Home/End (skipping options with `o.disabled`), set `tabIndex={on ? 0 : -1}`, and wrap panel content in `role="tabpanel" aria-labelledby={activeTabId}`.

### WR-05: Calm mode "tap to show animation" is mouse/touch only

**File:** `src/components/Recorder.tsx:307-311,442-444`
**Issue:** The only way to leave calm mode is a click on a non-interactive part of the hero `<div>`, which is not focusable and has no key handler. The visible hint "Tap to show the animation" cannot be acted on by keyboard users. Calm mode is also entered on long recordings (over 10 min), low battery and hidden page, so it is the normal state for most recordings.
**Fix:** Render the hint as a `<button type="button" onClick={boost}>` ("Show animation") instead of a `<p>`, and keep the area-click as a convenience.

### WR-06: ShareMenu `role="menu"` contains a non-menuitem, and the mobile sheet is not modal

**File:** `src/components/ShareMenu.tsx:160-179`
**Issue:** On phones the "Close share menu" `Button` sits inside `role="menu"` but is not a `menuitem`, which is an invalid menu structure; some SRs drop it or announce wrongly. The sheet also has a backdrop that blocks pointers but no `aria-modal`, no focus trap and no `inert` on the page, so Tab leaves the sheet into the page behind it while body scroll is locked. The focus-restore `anchor?.focus()` is in the effect cleanup that also depends on `desktop`, so a viewport/orientation change that flips `desktop` while open steals focus to the anchor, and the effect re-runs.
**Fix:** Move the close button outside the `role="menu"` element (wrap in a `role="dialog" aria-modal="true"` container on mobile). Restore focus only when `open` goes false, not on every dependency change (split into a separate effect keyed on `open`).

### WR-07: Waveform ring buffer advances only when the level changes

**File:** `src/components/Waveform.tsx:26-39`
**Issue:** The push happens in an effect keyed on `clamped`. If the mic level is unchanged between ticks (silence returning exactly 0, or quantised levels), no sample is pushed, so the bar history stops scrolling and the time axis is non-uniform. On pause (`level` forced to 0) only one zero is pushed and the old bars stay frozen. The buffer is also stale when `reduced` flips back to false (calm to live): old samples reappear.
**Fix:** Push on a fixed cadence (interval or on every parent tick regardless of value, using a `tick` counter prop), and clear `buf.current = []` when `reduced` turns on or the component pauses.

### WR-08: `useBackgroundRecording` / hero click handler issues are minor, but the Toast stack collides with the phone recording bar

**File:** `src/components/Toast.tsx:62`, `src/components/Recorder.tsx:727`, `src/components/RecordingPill.tsx:18`, `src/components/UpdateNotice.tsx`
**Issue:** Toast, the Recorder phone bar, RecordingPill and UpdateNotice all anchor to `bottom-[calc(88px+safe-area)]`. During recording on a phone, a "Synced", "Copied" or "Back online" toast renders on top of the recording bar (z-50 over z-30), hiding the Stop and Pause buttons for 2.7 s. The "Synced" toast fires right after stop, but "Back online" can fire mid-recording.
**Fix:** Stack them (give the toast a larger offset when `showBar`/pill is visible, for example via a CSS variable set by the bar), or keep toasts off the bar's row.

## Info

### IN-01: Orb writes to a ref during render

**File:** `src/components/Orb.tsx:23`
**Issue:** `target.current = ...` during render is flagged by the React Compiler/eslint `react-hooks/refs` rule and is unsafe under concurrent rendering (discarded renders still mutate it).
**Fix:** Assign inside `useEffect(() => { target.current = clamped; })`.

### IN-02: Pre-paint script and `motionPref` duplicate the storage key literal

**File:** `src/app/layout.tsx:10-11`, `src/lib/motionPref.ts:6`
**Issue:** `"transcriber.motion"` is hard-coded in both places. A rename of `MOTION_KEY` silently breaks the first-paint behaviour. `manifest.ts` theme_color is dark-only while `viewport.themeColor` is light/dark; install-time colour will differ from the in-browser one.
**Fix:** Build `MOTION_SCRIPT` from the exported `MOTION_KEY` (template string); consider a light-matching manifest theme or accept the difference deliberately.

### IN-03: ConnectivityPill is mounted twice and wraps the dialog in a live region

**File:** `src/components/ConnectivityPill.tsx:17-18,50-52`, `src/components/AppShell.tsx:90,140`
**Issue:** Sidebar and top bar both mount it (one is `display:none`), so the "Back online" effect runs twice and calls `toast()` twice, and two overlay registrations are possible. The root `role="status" aria-live="polite"` also encloses the offline help dialog, so opening it makes SRs read the whole panel. The panel offset uses `env(safe-area-inset-top)` instead of `var(--safe-area-inset-top, env(...))` used elsewhere, which is inconsistent in the Capacitor shell.
**Fix:** Put the live region only around the `sr-only` announce span; mount a single instance (or gate the toast on a single one); use the same safe-area var pattern.

### IN-04: Success toasts over-claim and fire for share-sheet hand-offs

**File:** `src/components/MeetingView.tsx:331-334`
**Issue:** `shareOrSave` returning `"ok"` fires "Saved PDF / Saved Word file / Saved text file" even when the file went to the native share sheet (the user may have picked a target or dismissed after delivery). The text is misleading on native.
**Fix:** Use "PDF ready" or "Shared", or branch on native vs web.

### IN-05: `linear()` spring easing has no fallback

**File:** `src/app/globals.css:54`, `src/components/Recorder.tsx:404`, `src/components/ui.tsx:122,370`
**Issue:** `--spring` uses CSS `linear()` easing (Chrome 113+). On an out-of-date Android System WebView the whole `transition`/`animation` declaration is invalid at computed-value time, so the Stop-button morph, segmented indicator, switch knob and toast/pop-in fall back to no animation. It degrades gracefully but is untested on the target Xiaomi device. Consider `@supports (transition-timing-function: linear(0, 1))` with a `cubic-bezier` default.
**Fix:** Define `--spring` as `cubic-bezier(0.34,1.56,0.64,1)` and override inside `@supports`.

### IN-06: Transcript tail rows keyed by index; first-paint `text-in` does not replay once the window is full

**File:** `src/components/TranscriptView.tsx` (row `key={i}`, `text-in` on tail rows)
**Issue:** With a sliding tail window the key is the index within `visible`, so once the window is full, new lines reuse existing DOM nodes. The entry animation only plays until the window fills, and rows' content swaps in place. `speakerColor(p.speaker)` also assumes a non-negative integer: a negative or NaN speaker yields `var(--speaker--1)`, which is undefined and makes the border fall back to currentColor. `isTranscriptPart` only checks `typeof speaker === "number"`.
**Fix:** Key by the absolute part index (`hidden + i`) and clamp with `((s % 6) + 6) % 6` in `speakerColor` (and in `RenameSpeakerSheet` line 84).

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
