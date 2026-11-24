---
phase: 06-ui-polish-leftovers
plan: 01
requirements: [POL-01, POL-02, POL-03]
completed: 2026-11-24
---

# Phase 6 Plan 01: UI Polish Leftovers Summary

Recording pill is now a container with working pause/resume and stop (shared RecordingControls), plus light-mode contrast and token-hygiene fixes from the Phase 5 UI review.

## What changed
- POL-01: new `RecordingControls.tsx` (40 px pause/resume + stop, `useFloatingBarFlag`). Used by the Record phone bar and `RecordingPill` (Link body to "/" + controls; shown bottom-right on lg; hidden on "/"). Pill calls `MeetingRecorder.pause/resume/stop({force:false})`, the same calls as `useNativeRecorder`; the service finalizes the meeting. Web recordings stop on leaving Record, so no in-page recorder exists off that route.
- POL-02: Switch off-track and radio ring use `muted-foreground/75` (>=3:1 on card, tested in `tests/contrast.test.ts`). Idle timer was already full-strength `text-muted-foreground`.
- POL-03: `text-[13px]` -> `text-meta`; login/AuthGate headings `text-2xl`; MeetingView title/prose h1 `text-2xl`; `rounded-lg/xl` -> `rounded-btn`/`rounded-chip`; PanelHeader, inputCls, OptionList, Notice, Recorder panels moved to 12/16 px; Toast sits 88 px above bottom (144 px only when `html[data-float-bar]` is set by pill/phone bar); top bar `bg-background/90`; waveform gap 3 px.

## Deviations
- Hand-positioned hero pause button (`-ml-[124px] -mt-7`) left as is: it is positioned relative to the orb stack, a flex rewrite risks the hero layout without a device check.
- Native stop from the pill does not mirror the final transcript to the local store until Record is next opened (mirroring lives in useNativeRecorder).

## Verification
tsc clean, `npm test` 185 pass, `npm run build` ok.
