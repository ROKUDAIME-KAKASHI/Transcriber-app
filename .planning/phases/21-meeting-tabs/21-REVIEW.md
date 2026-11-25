---
phase: 21-meeting-tabs
reviewed: 2026-11-25
depth: standard
status: issues_found
findings: { critical: 0, high: 1, medium: 4, low: 5 }
---

# Phase 21 Code Review

Verified unchanged: `ACTION_ITEMS_INSTRUCTIONS` is byte-identical to the old `TEMPLATE` text (only the template wrapper moved). The /process prompts (CONTEXT, structures) were moved verbatim into minutesPrompts.ts and recomposed to the same strings. Owner scoping (`{ id, userId }`) is correct in /generate, /ask and loadMeetingForAi. The server "write only if none" guard (`updateMany` with `document null/""`) is atomic, so there is no write race in /generate.

## High

### H-1 Hindi/Devanagari questions get no useful retrieval (BM25 tokenizer drops combining marks)
`src/lib/askMeeting.ts:35-39` `tokenize` splits on `/[^\p{L}\p{N}]+/u`. Devanagari vowel signs, virama and nasalization marks are `\p{M}`, so words are cut apart. I ran it: "किताब पढ़ना" gives `क, त, ब, पढ, न`. All fragments are 1 char and are removed by `w.length > 1`. A Hindi question has no tokens, `anyMatch` is false, and `selectChunks` sends only the first ~2500 words. For long Hindi or mixed meetings the answer then comes from the wrong part, or the model says "not in the excerpts". Mixed text only matches the Latin words.
Fix: split on `/[^\p{L}\p{M}\p{N}]+/u`, and apply the length filter to the whole token. Add a Hindi test.

## Medium

### M-1 Once-only book and extras are not account-scoped, so an account switch burns another user's entries
`src/lib/minutesJob.ts:181-207`, `AutoMinutesRunner.tsx:29-33`. `minutely.autoMinutes.v1` is global per device. `pendingAutoIds()` returns every queued id, including user A's. After sign-out and sign-in as B, `runAuto(B, A's id)` runs. `flush()` (`sync.ts:489-493`) does `repo.getMeta(B, id)`, gets null and returns "synced". `/generate` then returns 404, which `generateAll` treats as "switch off" and falls back to `/process`. That is also 404, so the entry is `settle(...,"failed")` permanently. When A signs back in, the meeting is never auto-written. It also wastes requests.
Fix: store `userId` in the Entry (set in `enqueueAuto`, which needs the user), and filter `queuedIds` and `claim` by the current user. Or key the book by `${userId}:${meetingId}`. Also do not treat a 404 whose body is "Meeting not found" as a flag-off fallback (`minutesJob.ts:101`); only `fallback:true` or the flag-off 404 body should fall back.

### M-2 Local leftovers survive sign-out on a shared device
`meetingExtras.ts` (`minutely.extras.<id>`: summary and unsaved action-item candidates with source quotes), `AskTab.tsx:19` (`minutely.ask.<id>`: full Q/A chat history), `minutely.autoMinutes.v1` and `minutely.genTimes`. A grep finds no sign-out cleanup for any of them. The next account on the device can read them from devtools or the WebView. The ids are cuids, so the UI can't open them. This is still meeting content left at rest after sign-out, and the pending-items cache is never expired.
Fix: prefix the keys with userId, or remove `minutely.extras.*`, `minutely.ask.*` and the book on sign-out and on a userId change. Sweep entries older than N days.

### M-3 `only:"summary"` bypasses the 12k-word cap
`generate/route.ts:73`: `words > COMBINED_MAX_WORDS && !opts.only`. A 10-hour transcript (100k+ words) is sent whole to GLM in "Write summary", with a 90 s timeout. It fails with an opaque 502/context error, or is expensive. Fix: for `only`, truncate or sample the text (for example head, middle and tail up to the cap), or return a clear 400 "too long for summary".

### M-4 Transcript or excerpt text can break out of the untrusted wrapper
`combined.ts:68` wraps the transcript in `<transcript>...</transcript>`, and `askMeeting.ts` wraps excerpts in `<excerpts>`. Neither escapes a literal `</transcript>` or `</excerpts>` in the text. Another speaker in a call can say or type one and then add "instructions". The title and speaker names are also unescaped. The impact is bounded: there are no tools and no exfiltration, and quotes are checked against the transcript. It can still skew minutes and answers, and "verified" items are no defence because the injected text is in the transcript. Fix: replace `</transcript>` and `</excerpts>` (case-insensitive) in the interpolated text with a harmless variant, and strip newlines from the title.

## Low

### L-1 `Recorder.tsx` enqueues once and can lose the meeting
`Recorder.tsx` (the new effect): `queuedMeeting.current = rec.meetingId` is set before `enqueueAuto`. If `words < 60` at the moment `finished` flips (late final parts, cloud engine flush), `enqueue` returns false and the ref blocks any retry in this mount. Also `enqueueAuto` has no user check, and a signed-out recording is queued for whoever signs in next (see M-1). Fix: set the ref only when `enqueueAuto` returns true or the word count is final, and record userId.

### L-2 Fallback after a parse failure can overwrite minutes written meanwhile
When `/generate` returns `fallback:true` (parse failure or a long meeting), the client calls `/process`, which is unconditional (unchanged old behaviour). A second device that wrote minutes during the 200 s combined call is overwritten, and the combined call plus the fallback cost two AI calls. Fix: pass `force` through, or have `/process` skip when a document exists and `force` is false (only for the auto path).

### L-3 `/generate` in-flight dedupe key ignores `template`, `model` and `force`
`generate/route.ts:42`. A concurrent "Report" request attaches to a running "MOM" run and returns MOM, and the client shows it as the Report. Fix: include template, model and force in the key.

### L-4 `quoteVerified` accepts 3-character quotes
`askMeeting.ts:178-181`. A quote like "the" is "Found in transcript". Raise the minimum (about 8 chars, or 3 words), or require that the quote not be a stopword.

### L-5 Persisted-tab behaviour change with `meetingTabs` off
`MeetingView.tsx` init effect: with the flag off the page still restores the last tab from `minutely.meetingTab` and rewrites `?tab=`. The old page always opened on Document-or-Transcript. To restore the old behaviour exactly, skip the saved tab (and the `replaceState`) when `tabsOn` is false. Also, `tabInit` runs once with the initial `tabs`. If flags load late, the saved tab is already ignored for tabs that did not exist yet, which is harmless.

## Notes (checked, no defect)
- Credit-burn loops: failed runs settle to "failed" and are not retried automatically. "queued" resets happen only for unsynced or offline cases, which cost no AI calls.
- Android back: `history.replaceState` for tab changes adds no entry, so back behaviour is preserved.
- Empty transcript is guarded in /generate (400) and /ask (400). BM25 is safe for N=0 and an empty query.

## Fixes

All findings fixed (tsc, 518 tests, build, check-build pass).
- H-1: `tokenize` splits on `[^\p{L}\p{M}\p{N}]+`; Hindi test added.
- M-1: auto-minutes entries carry `userId`; `queuedIds`/`claim` filter by user; `enqueueAuto(userId, ...)`; a 404 "Meeting not found" is no longer a flag-off fallback. Test added.
- M-2: `minutely.extras.<user>.<id>` and `minutely.ask.<user>.<id>` are keyed by account and carry a timestamp; `sweepLocalMeetingData()` (on sign-in, from AutoMinutesRunner) removes unscoped legacy keys and entries older than 30 days. `minutely.genTimes` is only word/second counts (no meeting content) and was left as is.
- M-3: summary-only path uses `capTranscript` (head, middle, tail, at most the 12k-word cap).
- M-4: `neutralizeWrapperTags` on transcript, excerpts and header; titles are one line.
- L-1: Recorder remembers the meeting only once `enqueueAuto` returns true, and passes the user id (waits for sign-in).
- L-2: `/process` accepts optional `onlyIfEmpty` (sent by the non-force fallback) and returns existing minutes instead of overwriting.
- L-3: in-flight key includes template, model and force.
- L-4: a quote needs >= 12 characters or >= 3 words.
- L-5: with `meetingTabs` off the saved tab is not restored (init waits for the flag).
