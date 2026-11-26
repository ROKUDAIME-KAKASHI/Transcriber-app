# UI-POLISH-1 (branch ui-polish-1)

Phase 1 "rules pass" from `.planning/research/DESIGN-REVIEW.md`. Tokens/CSS first; no behaviour changes.

- Shadows: `--elev-card` is `none`, `--elev-float` is a 1px border ring (both themes). Removed primary-button glow (ui.tsx, MeetingList, PlanPage) and the Record button 6px ring.
- Blur: `.glass` is now solid `--card` with a hairline border, no backdrop-filter. Removed body radial glow and the empty-state blurred gradient (Orb kept).
- Radii: chip/btn/panel 10/14/22 -> 8/12/20; the logo tiles `rounded-[10px]` -> 8px.
- Accent: light `#1c68e0` (not the requested `#1f6feb`, which is 4.34:1 on the page background and fails the AA contrast test; `#1c68e0` is 4.79:1 on background and 5.11:1 with white text). Dark `#4c8df6` (5.87:1 on background, dark text on accent 5.87:1). `--speaker-0` follows the accent. `--speaker-5` is now cyan (`#0a7ea4` / `#5cc8ee`), distinct from teal speaker-1. Soft/hover variants derive from `--accent` via color-mix and `/90`.
- Hindi: body line-height 1.5, `:lang(hi|mr)` 1.7, UI text line-height 1.5rem; font stack adds "Noto Sans Devanagari", "Nirmala UI", "Mangal" (system fonts, no downloads). Transcript and minutes paragraphs already use 1.6; no tight `leading-*` on text. Still needs a device check.
- Left: PWA icon art (`assets/icon-art.svg`, `api/icons`) still uses the old `#3651F5`.
