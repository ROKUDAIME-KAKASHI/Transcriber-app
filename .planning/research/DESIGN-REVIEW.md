# Minutely UI review and design inspiration (2026-11-26)

Method: code read (globals.css, AppShell, ui.tsx, Recorder, MeetingList, MeetingTabBar, SummaryTab, meetingTabs) plus web research. No screenshots, no code changes. Plan/Tracker/People/Admin pages, MeetingView and AskTab were not read in depth.

## Verdict
Good enough to keep. It is already coherent: tokens, a small primitive set (Button, Panel, Notice, Switch), a 13px type floor, reduced-motion handling, dark mode, an accessible tab bar, good empty states and offline copy. The work is a **polish and rules pass**, not a redesign.

## Top problems
1. **Shadows and blur everywhere (rule: none).** 35 `shadow-card` / `shadow-float` uses. `Panel`, secondary `Button` and every meeting-list row carry a shadow; the primary button has an accent glow. `.glass` blur is on the phone tab bar (the nav), the recording pill, toasts, the phone recording bar and the empty-state icon. The Record button has a 6px ring shadow. Dark mode adds inset highlights.
2. **Radii are 10/14/22, not 8/12/20** (`--radius-chip/btn/panel`). Tokens, so the fix is three lines. `rounded-full` (59 uses) is a fourth family; keep it only for the record button, chips and toasts.
3. **Colour is not 90-95% neutral.** Body has an accent radial glow; the Orb, empty-state blur gradient and glow tokens add more. Accent `#3651f5` reads blue-violet, and `--speaker-5` is violet. Speaker colours are legitimate content colour; chrome should stay neutral.
4. **Record screen is crowded for a "tap and go" screen.** The hero (timer, orb, one big button) is good. Under it stack status, calm-mode text, sample-audio button, gate reason, sound switch and notices, then the Speech engine selector, offline model control and Options. A non-technical user must parse "Speech engine" before first use. The empty Transcript panel also sits below on phones.
5. **Meeting page has 5 tabs** (Transcript, Minutes, Summary, Action items, Ask). Summary and Minutes overlap in the user's mind; on a 375px phone the row scrolls sideways. What people want after a meeting (minutes, action items) is not first. Summary has a heavy empty state.
6. **Meetings list rows are dense.** Title, mono metadata (duration, time, device) and 2-3 chips on the right (status, sync, duplicate). Title is squeezed on phones. "Sync" chip is jargon.
7. **Hindi/Devanagari.** Font stack is Geist plus system fallback, so Hindi renders, but UI line-height 1.375 can clip matras. Uppercase tracked group labels and tight heading tracking do nothing for Hindi. No Devanagari line-height or font set. Needs a device check.
8. **Trust cue.** Recording state is clear (red label, timer, live dot, pill on other pages). Missing: one plain privacy line near the record button ("Stays on this phone" vs "Cloud: audio is sent to Deepgram").

## Borrow list
| # | Idea | Source | Applies to | Effort |
|---|------|--------|-----------|--------|
| 1 | Receding chrome: quieter nav and labels, softer borders, fewer filled containers ("structure felt, not seen"). Cures problems 1-3. | Linear 2026 refresh | Whole app (tokens, Panel, nav) | S-M |
| 2 | Show where an AI line came from: tap a minutes bullet to see the transcript lines behind it; chat answers with citations. Builds trust. | Granola (source view, Chat citations) | Minutes, Ask | Ask citations S-M; minutes source M-L |
| 3 | Rename a speaker for "this line" or "everyone", generic Speaker 1/2 defaults, stable colour per speaker. `RenameSpeakerSheet` exists; add the choice. | Google Recorder | Transcript | S |
| 4 | Search inside a meeting, hits jump to the spot. List search already exists. | Google Recorder, Apple Voice Memos | Transcript | S-M |
| 5 | Live transcript is the star of the phone recording screen (current line highlighted, "Jump to live"); fold engine, language, mic and model behind one Settings row. | Apple Voice Memos, Google Recorder | Record (phone) | M |
| 6 | Action items as the headline of the recap with owner and one-tap add to Tasks; fold Summary into the top of Minutes. | Fathom, Fireflies | Meeting page | M |
| 7 | One thin talk-time strip per speaker (coloured bar, percentages). Uses data you already have. | Otter | Meeting header | S |
| 8 | Meeting-type templates (Review, 1:1, Client call) shaping the minutes. Only if users ask. | Granola | Minutes generation | M (backend) |

Best for phones and non-technical users: 1, 3, 5, 6, 7. Idea 2 is the strongest trust feature but the biggest.

## Leave alone
- Tab bar a11y, roving focus, edge-fade scroll hint; Segmented, Switch and Notice primitives.
- Orb plus single big record button, state label, timer, "Jump to live", the recording pill on other pages.
- Offline copy, gate reasons ("why is this disabled"), skeletons, empty-state wording.
- Type scale (13/15/17), two weights, 44px+ targets, reduced-motion support, dark palette contrast.
- Speaker colour set (content colour, not chrome).

## Plan (simplest version)
**Phase 1: rules pass, about half a day, one PR, low risk.** Mostly CSS variables, since components go through tokens and `ui.tsx`.
- Radii to 8/12/20 in `globals.css`.
- Shadows: `--elev-card` to `none`, `--elev-float` to a 1px border; drop the primary-button glow; replace `.glass` with solid `bg-card` plus hairline (no blur).
- Remove the body radial glow and the empty-state blur.
- Confirm accent hue with the owner (swap only if agreed).
- Hindi: Devanagari line-height about 1.6 and a Noto Sans Devanagari fallback; test on a phone.

**Phase 2: Record and list calm-down, about 1 day.**
- Record: hero, sound switch and one "Settings" row (engine, language, mic, offline model). One privacy line under the button.
- List: title, one metadata line, a single status chip; move sync/duplicate into the detail.

**Phase 3: meeting page, 1-2 days.**
- Tab order: Minutes, Action items, Transcript, Ask. Fold Summary into the top of Minutes.
- Talk-time strip, rename "this line / everyone", in-transcript search.

**Later, only if wanted:** Ask citations, then minutes source view, then templates.

## Sources
- Linear, "A calmer interface for a product in motion" (2026-03-12): https://linear.app/now/behind-the-latest-design-refresh ; https://linear.app/changelog/2026-03-12-ui-refresh ; https://linear.app/now/a-design-reset
- Granola: https://granola.ai/updates ; https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes.md ; https://www.granola.ai/blog/what-is-an-ai-notepad
- Google Recorder: https://support.google.com/pixelphone/answer/16269004 ; https://research.google/blog/who-said-what-recorders-on-device-solution-for-labeling-speakers/ ; https://9to5google.com/2023/12/29/ode-to-pixel-recorder/ ; https://9to5google.com/2025/08/23/pixel-recorder-material-3-expressive/
- Apple Voice Memos: https://support.apple.com/en-mide/guide/ipad/ipad282bee5e/ipados ; https://support.apple.com/guide/voice-memos/vma2c8c0a040/mac
- Otter: https://tldv.io/blog/otter-ai-review/ ; https://www.g2.com/products/otter-ai/reviews
- Fathom / Fireflies / tl;dv: https://zapier.com/blog/fathom-vs-fireflies ; https://www.g2.com/compare/fathom-video-vs-tl-dv ; https://zapier.com/blog/best-ai-meeting-assistants/
- Caveat: product details come from search summaries, not hands-on use. Things, Superhuman, Notion and Fireflies layouts were not researched in depth; Linear covers the "calm" reference.
