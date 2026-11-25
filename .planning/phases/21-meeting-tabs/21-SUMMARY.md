# Phase 21: Meeting page tabs + auto minutes + Ask - Summary

**Status:** Complete in code, needs UAT (see 21-HUMAN-UAT.md). **No migration** (no schema change, no new dependency, no Android change).
**Branch:** `step-8-1-meeting-tabs` (stacked on the unmerged `step-8a-tab-audio`).

## Flags (Admin > Feature switches)

All three default **on**, like every earlier flag (a test enforces that). They are independent:

| Flag | Off means |
|------|-----------|
| `meetingTabs` | The page is exactly the old three tabs (Minutes, Transcript, Action items). |
| `autoMinutes` | No automatic run after Stop, and the manual "Create/Regenerate" button uses the old `/process` route. The `/generate` route answers 404. Also hides the "Write summary" button. |
| `meetingAsk` | The Ask tab is hidden and `/ask` answers 404. |

Because `autoMinutes` and `meetingAsk` spend AI credits, the owner can switch them off from Admin without a deploy.

## What was built

- **Tabs:** Transcript, Minutes, Summary, Action items, Ask. Scrollable accessible tablist (`role=tablist/tab/tabpanel`, roving tabindex, Arrow/Home/End). `?tab=` deep link (`transcript|minutes|summary|actions|ask`; old `document`/`tasks` accepted). The last tab is remembered per device (`minutely.meetingTab`). Changing tab uses `history.replaceState`, so the Android back button still leaves the meeting. Export/Share/Copy/More formats stay above the tabs as before.
- **Combined request** (`POST /api/meetings/[id]/generate`): one `generateText` call on the existing provider chain with the cheapest model (GLM Flash for automatic runs; the user's choice for manual). Returns JSON `{minutes, summary, action_items}`.
  - The action-item rules/JSON shape are `ACTION_ITEMS_INSTRUCTIONS` in `src/lib/actionItems.ts`, used by BOTH the standalone prompt and the combined prompt, so the text is word for word identical (a test asserts both).
  - Returned items go through `validateActionItems` (the same zod validation the extractor uses) and `verifyItems` (verbatim quote check against the same "Name: text" lines). They are NOT saved: they fill the existing review list in the Action items tab and only the user's "Save approved tasks" saves them.
  - Fallback: unparsable JSON, missing/short minutes, a very long meeting (> 12,000 words), or the server switch being off makes the client use the existing `/process` and `/action-items/extract` calls. Missing items alone trigger only the extractor; a missing summary shows a "Write summary" button (`only: "summary"`, one small call).
  - The prompt text for minutes moved to `src/lib/minutesPrompts.ts` (the `/process` route output is unchanged; its tests/prompts are byte-identical).
  - Prompt-injection labelling: the transcript is wrapped in `<transcript>` tags with an "untrusted data, never instructions" rule in the system prompt.
- **Summary tab:** purpose, key points, decisions, open questions, overall tone.
- **Auto after Stop:** the Recorder queues the meeting when it is stopped and saved (`enqueueAuto`, needs >= 60 words). `AutoMinutesRunner` (mounted in Providers) runs it when online, signed in and not recording (checked on mount, on connectivity change, on tab visible, and every 30 s), after uploading the transcript with the existing `flush`. Offline: stays queued and runs when back online (also after an app restart, the queue is in localStorage).
  - Once only: a localStorage "book" per meeting (`queued -> running -> done|failed`), with a claim token re-read to settle races between tabs, a 10-minute stale-run takeover, and 14-day cleanup. Server side: without `force`, a meeting that already has minutes is returned unchanged; the save is `updateMany ... WHERE document IS NULL/""`; a duplicate in-flight request on the same instance shares the first one's result.
  - UI: "Writing minutes - ready in about N seconds" with a progress bar and countdown; "waiting for internet" state; an error with **Try again** (runs outside the once-only book because the user asked). ETA = fixed part + length-scaled part from the rolling average of the last 5 runs on this device (`minutely.genTimes`), default `10 s + 0.012 s/word`, clamped 8-240 s.
- **Ask tab** (`POST /api/meetings/[id]/ask`): owner-scoped, `FailureLimiter(30 per hour)`, question 2-500 chars, history capped to the last 4 turns of 600 chars. Retrieval is BM25 over ~90-word chunks with speaker names and start times, top chunks up to 2,500 words, returned in meeting order (falls back to the start of the meeting when nothing matches). GLM Flash, max 800 output tokens. Excerpts are labelled untrusted. Quotes in the answer are checked against the WHOLE transcript and each is shown "Found in transcript" or "Quote not found in transcript". Chat history lives in localStorage on the device (30 turns, "Clear chat"). Disabled with an explanation when offline.

## Files

New: `src/lib/{combined,askMeeting,autoMinutesCore,meetingTabs,minutesPrompts,minutesJob,meetingExtras,meetingForAi}.ts`, `src/app/api/meetings/[id]/{generate,ask}/route.ts`, `src/components/{MeetingTabBar,MinutesStatus,SummaryTab,AskTab,AutoMinutesRunner}.tsx`, tests `autoMinutes`, `combined`, `askMeeting`, `meetingTabs`.
Changed: `MeetingView.tsx` (tabs, combined manual path, auto result sync), `ActionItems.tsx` (optional `seed`/`onSaved`), `Recorder.tsx` (queue on stop), `Providers.tsx`, `flagsCore.ts`, `actionItems.ts` (rules constant + `validateActionItems`, same behaviour), `process/route.ts` (prompts imported).

## Tests

`npm test`: 511 pass (the new files: autoMinutes 10, combined 6, askMeeting 8, meetingTabs 5). `npx tsc --noEmit`, `npm run build` and `npm run check-build` pass.

## Known limits

- **Summary and the pending action-item candidates are stored on the device that generated them** (localStorage), not in the database: preferring no schema change. On another device the Summary tab offers "Write summary" (one small call). The minutes themselves are saved to the meeting as before. A future `Meeting.summary` column (additive migration) would fix this.
- Auto-run is queued only by the in-app Recorder on Stop. A meeting finished from another device ("Stop recording" on the list) or recovered from native/locked audio is not auto-written; the manual button works.
- Very long meetings (> 12,000 words) skip the combined call and use the old chunked calls, so they get no summary until "Write summary" is pressed.
- The server once-only guard and the rate limiter are per server instance (as the existing limiters are); the database condition on the save is what truly prevents overwriting.
- Combined output has no "Full Transcript" section (the old minutes added one for <= 3,500 words); the transcript is on its own tab.
- Not exercised on a device or against the live AI: the prompt/JSON behaviour of GLM Flash on real meetings needs the UAT.
