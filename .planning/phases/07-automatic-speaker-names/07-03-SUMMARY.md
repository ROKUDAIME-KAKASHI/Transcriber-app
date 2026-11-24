---
phase: 07
plan: 03
requirements-completed: [NAME-01, NAME-02, NAME-03]
key-files:
  created: [src/lib/nameSuggest.ts, src/components/NameSuggestions.tsx]
  modified: [src/components/MeetingView.tsx, src/components/Recorder.tsx]
commit: c0a451e
---
# Phase 7 Plan 3: Hook, chips and wiring Summary

`useNameSuggestions` (device rules automatic; AI only on tap via "Find names with AI", gated by `useFeatureGate("ai")`; dismissals + AI result cached in Dexie kv `names:<meetingId>`, no schema change). `NameSuggestions` chips: Use / Edit (RenameSpeakerSheet prefilled) / Dismiss, Use all when several. MeetingView renders it under the speaker chips when status is DONE and now builds renames from a `namesRef` with a batch `renameSpeakers` (fixes the stale-names overwrite). Recorder renders it after stop for the web recorder only (3-line change; native/Deepgram path has no rename, gets suggestions on the meeting page).

## Verification
`npx tsc --noEmit`, `npm test` (199 pass), `npm run build` all pass.

## Deviations
None. Visual/phone behaviour not verified (see 07-HUMAN-UAT.md).

## Self-Check: PASSED
