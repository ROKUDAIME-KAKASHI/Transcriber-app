# UI-OVERHAUL (branch ui-overhaul)

Phases 2 and 3 of `.planning/research/DESIGN-REVIEW.md`, plus a theme switch. No data, API or recording-logic changes.

## Theme (commit 1)
- `globals.css`: dark tokens live under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `:root[data-theme="dark"]` (kept identical; a contrast test checks it). `color-scheme` follows. A `@custom-variant dark` makes Tailwind `dark:` follow `data-theme` too.
- `lib/theme.ts` (pure: parse, resolve, toggle, `THEME_INIT_SCRIPT`) and `lib/themePref.ts` (hook, saves `transcriber.theme`, updates `<html data-theme>` and the `theme-color` metas). Inline head script in `layout.tsx` applies the saved choice before paint (try/catch). No CSP exists, so inline is fine.
- UI: System/Light/Dark in Profile > Preferences; sun/moon `ThemeToggle` in the phone top bar and laptop sidebar. No Android status-bar helper exists, so none was changed (the WebView theme-color meta is updated).

## Record + list (commit 2)
- Record: one collapsed "Settings" row (summary "On this device · English") holds engine, offline model, language, mic, options. Privacy line under the button by engine (`lib/recordSummary.ts`). On phones the Settings row hides while recording and the transcript is taller (68dvh).
- List rows: title + "26 Nov · 10:30 · 12:34" + at most one chip (Live / Needs finishing / Not responding / Couldn't upload / Uploading... / Not uploaded yet / Possible duplicate / Minutes ready). Device name and Transcript chip dropped from the row.
- Not done: "speakers" in the meta line. The list rows have no speaker count (it needs the parts), and adding it would mean a data change.

## Meeting page (commit 3)
- Tabs (switch on): Summary & minutes, Action items, Transcript, Ask. `?tab=summary` maps to minutes; saved `summary` too. Switch-off path unchanged.
- Summary renders (compact) above the minutes; with no summary it is a slim "Write summary" row, or nothing.
- Default tab: link > remembered > Action items when any exist > minutes > transcript. Existence comes from `extras.items` at once, then one GET of the saved action items; it never overrides a tab the person chose.
- Transcript: talk-time strip (`lib/talkTime.ts`, needs 2+ speakers) and a search box that filters paragraphs and highlights (`lib/transcriptSearch.ts`), all client-side.

## Tests
New: theme, recordSummary, talkTime, transcriptSearch; updated meetingTabs, contrast.

## Unverified
No device or browser check yet: look at 360px (Record Settings, the 4-tab row still scrolls sideways inside itself because "Summary & minutes" is long) and both themes.
