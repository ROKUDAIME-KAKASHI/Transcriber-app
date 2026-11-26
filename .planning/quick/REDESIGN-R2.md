# REDESIGN-R2 (branch redesign-r2): Record screen

Visual and layout only. Recording, transcription, saving, native and offline logic and `useRecorder` untouched. No new dependencies.

## Layout
- Laptop: two columns (left 400px: timer, record control, waveform, input status lines, privacy line, Settings row; right: live transcript). Phone/tablet: stacked, same order; hero is short while recording so the transcript gets the height.
- Session title: the recorder has no editable title, so only the existing "Recording as: X" prefill line is shown.
- The Orb glow is gone from the hero (the canvas waveform replaces it). `Orb.tsx` is left in place, unused.

## Control states (`lib/recordControl.ts` `recordControlState`, `RecordButton.tsx`)
ready (accent outline, mic), starting (spinner), recording (record colour, stop icon, pulse ring only in `calmMode` "live", so not under reduced motion), paused (muted, "Paused"), saving (spinner, "Saving…"), saved (tick, "Saved" + "Meeting saved / Open meeting" row), error (danger Notice with the hook's own `statusMsg`). Each has a text caption. Pause/resume/stop wiring unchanged.
- Error is inferred: not recording, `saveState` idle and `statusMsg` not "Ready"/"Cancelled.". The hook has no explicit error field. Native `n.status` strings were not all checked, so a stray native message while idle could show as an error.

## Waveform (`LevelCanvas.tsx`)
Canvas, rAF only while recording and not paused; reads the existing `micLevel` through a ref (no analyser added, no hook change). Paused freezes the last frame, ready is a flat line, reduced motion/calm mode shows a plain level meter. rAF and ResizeObserver cleaned up on state change and unmount. In the APK `micLevel` comes from the native level; if it is 0 the bars stay at their minimum height.

## Transcript
Existing speaker colours/chips, "probably" chips and timestamps kept. Line-height 1.6, max 70ch. New paragraphs get a short accent wash (`.seg-new`, keyed by absolute paragraph index in the tail window). Auto-follow uses `isNearBottom` + `followAfterScroll` on a scroll listener (replaces the IntersectionObserver); "Jump to latest" (44px) resumes. Empty state: "Press record to start. The transcript appears here as people speak."; while starting, the hook's progress message shows with a spinner.

## Tests
`tests/recordControl.test.ts` (16): state mapping, input status lines, near-bottom / follow / jump button.

## Not checked
No device or browser pass: check 360px, both themes, the APK and a real recording.
