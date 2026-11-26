# Polish and hygiene (branch polish-hygiene)

## Part A: leftovers
- **Migration `8_polish`**: nullable `User.displayName` and `Meeting.summary` (TEXT, JSON). Written by hand in Prisma's format (the offline `migrate diff --from-migrations` needs a shadow database, and no database is touched in this pass). Owner step: `npm run db:migrate` against production (see DB-MIGRATIONS.md).
- **Safe before the migration**: every `Meeting`/`User` read already had an explicit `select`; the one bare `meeting.update` (process route) now has `select: { id: true }`. New columns are only touched by `src/lib/polishDb.ts`, which catches P2021/P2022 (summary: use the device copy; name: "You"; saving the name answers 503). Pure parts are in `src/lib/polishCore.ts`, tested in `tests/polish.test.ts`.
- **Summary on the server**: the generate route saves it (combined run and "Write summary"). `GET /api/meetings/[id]/summary`; SummaryTab shows the server copy first, then the device copy. Unreviewed action-item candidates stay local.
- **Your name**: Profile, Account. `GET/PUT /api/profile/name`, validated (trim, 40 chars, letters, spaces and `.-'`). Cached in localStorage (`src/lib/displayName.ts`) for offline use. Screen naming uses it instead of "You" (`meLabel`). Shown in the sidebar and account menu.
- **Browser Back closes the task panel** (`TaskTracker`): one history entry while the panel is open; Esc, the Android back key and the backdrop pop it again.
- **Offline notice** on Record is now one line above the Settings row.
- **Dead code**: `Orb.tsx` and its two CSS rules removed. `DESIGN-REVIEW.md` committed. `baseline-check.prisma` left alone.
- **Speaker count in the meetings list: skipped.** The list data (server and local rows) carries no speakers, only title, status, duration and so on. Title-only search unchanged.

## Part B: hygiene
- **Lint**: ESLint 9 + `eslint-config-next` 16.2.9, flat config in `eslint.config.mjs`, `npm run lint`, in CI. Style and React-compiler advice rules are warnings; the one real error (a function named `useAll` called in a handler) was renamed. About 147 warnings remain as a to-do list.
- **Smoke test**: `npm run smoke` (`scripts/smoke.mjs`) runs after a build, starts `next start` on a free port with a dead database URL (never reaches a real database) and checks public and signed-out routes plus the COOP/COEP headers.
- **Bundle budget**: `npm run bundle-budget` reads `.next/diagnostics/route-bundle-stats.json` (Turbopack prints no first-load sizes). Budget 1,820,000 bytes per route (largest today: /meetings, 1,576,304, plus 15%). Prints the top 5.
- CI runs lint, then after the build the check-build, budget and smoke steps.
