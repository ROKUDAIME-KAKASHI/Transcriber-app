# REDESIGN-R1 (branch redesign-r1)

Visual and layout only. No data, API, auth or recording changes, no new dependencies.

## Palette (`globals.css`, same token names)
Light: background #F6F5F1, card #FFFFFF, muted #F0F1F5, border #E5E7EB, text #202B3C, accent #356AE6 (soft #DCE7FF), success #16A58A, warning #E7A34B, danger/record fill #DC6262.
Dark: background #111827, card #1B2433, muted #253145, border #36445A, text #F3F4F6, secondary #9CA3AF, accent #5B87F0 (soft #1F2D4D, text #7AA2F7), success #25B99C, warning #EAAD5C, danger #E87474, record fill #DC6262.

Contrast adjustments (given colours kept for fills and borders; new `-text` tokens for text):
- `--accent-text` light #305FCF (accent is 4.27:1 on the page).
- `--success-text` #107A66, `--warning-text` #8D632E, `--danger-text` #AE4D4D (fills are 1.9 to 3.1:1 as text). `--record` (text) #AE4D4D.
- `--muted-foreground` #646D7F (given #697386 is 4.23:1 on the page; also keeps the 75% switch track at 3:1).
- Dark: `-text` tokens are lighter tints (#7AA2F7, #34D3B3, #F0B45F, #F28C8C); speaker-0 follows accent-text.
- All `text-accent/danger/success/warning` utilities were renamed to `text-*-text` (mechanical, 38 files). `tests/contrast.test.ts` checks the `-text` tokens (including on accent-soft) and the fills at 3:1.

## Other tokens
Radii: btn/input 10, card (panel) 12, modal 16 (`rounded-modal`, `rounded-t-modal` on sheets and dialogs); chips stay 8, pills only on chips/badges. One shadow: `--elev-float` (1px soft), cards none, no blur.
Type: Geist Sans/Mono were already loaded via `next/font`. New `.num` class (Geist Mono + tabular-nums) used on the recorder timer, recording pill and meeting list date/duration (meeting page and transcript already used mono).

## Layout (`AppShell.tsx`, new `AccountMenu.tsx`)
- Laptop: unchanged structure (logo, Record/Meetings/Tasks/Schedule/People, account + theme + sign out); active state is accent-soft with accent-text.
- Phone/tablet: opaque bottom bar with hairline top border, 4 items, 56px tall, safe-area padding (replaces the floating glass pill). Top bar now has one account button opening a menu: Profile, People (flag), theme, sign out. The recording pill sits 76px above the bottom.
- Unverified: no device check; look at 360px and both themes. PWA icon art still uses the old accent.
