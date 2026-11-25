# Database migrations

Until now the schema was applied with `prisma db push`. From now on every schema change is a tracked migration folder under `prisma/migrations/`, so a preview database, a dev branch and production can all be brought to exactly the same shape.

## What is in the repo

| Folder | What it creates |
|--------|-----------------|
| `prisma/migrations/0_init` | The whole schema as it is on the live database today (User, Meeting, ActionItem, Availability, EventType, Booking, AgendaDraft) |
| `prisma/migrations/1_safety` | New Step-0 tables: `ClientError` (error log) and `FeatureFlag` (feature switches) |
| `prisma/migrations/2_history` | Phase 11: `ActionItem.deletedAt` (soft delete) and the `ActionItemEvent` change-history table |
| `prisma/migrations/3_stakeholders` | Phase 12: the `Stakeholder` table (People directory) |
| `prisma/migrations/4_planned_meetings` | Phase 13: `MeetingSeries`, `PlannedMeeting` and `PlannedAttendee` tables |
| `prisma/migrations/migration_lock.toml` | Says the provider is postgresql |

## Step 0 (read-only): check the live database really matches `0_init`

Run this first. It only reads the database structure and writes nothing. It compares the live database (direct, non-pooled connection) with what the migration folders would build:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL_UNPOOLED" --to-migrations prisma/migrations --script
```

(`--to-migrations` needs a throw-away "shadow" database. If Prisma asks for one, add `--shadow-database-url <an empty scratch database>`, never the live one. A free empty Neon branch works.)

- **Output with only `CREATE TABLE "ClientError"`, `CREATE TABLE "FeatureFlag"` and their `CREATE INDEX` lines** (everything else empty): the live database already matches `0_init`, and the diff is exactly what `1_safety` will add. Safe to baseline.
- **Anything else** (`ALTER TABLE`, `DROP`, other tables or columns): the live database has drifted from `0_init`. Do NOT run `migrate resolve`. Send the output to the developer first.

An output of `-- This is an empty migration.` would mean `1_safety` was already applied, which is also fine.

## One-time baseline for the existing live database (owner does this once)

The live database already contains everything in `0_init` (it was created by `db push`), so `0_init` must be marked as already applied instead of being run. Run these from the project folder with the **live** `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used by Prisma migrate through `directUrl`) in your environment (the live values from Vercel / `.env`):

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy
```

1. `migrate resolve --applied 0_init` only writes a row into the `_prisma_migrations` table. It does not touch your data.
2. `migrate deploy` then applies `1_safety` (creates `ClientError` and `FeatureFlag`).

Check with `npm run db:status`. It should say "Database schema is up to date".

Until `1_safety` is applied the app still works: the error log and feature switches fall back gracefully when their tables are missing (defaults on, errors silently not stored).

## Apply 2_history (Phase 11)

Additive only: one nullable column and one new table, so the old app keeps working while it rolls out.

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production (live URLs from Vercel / `.env`).
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the app still works. Deleting a task removes it for real (no soft delete), no history is written and the History section in the tracker stays hidden. After it is applied, deleted tasks are kept hidden (`deletedAt` set) so their history survives.

## Apply 3_stakeholders (Phase 12)

Additive only: one new table (`Stakeholder`, soft-deleted via `deletedAt`) with an index and a cascade foreign key to `User`. Nothing existing changes.

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production.
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the app still works: the People page and its API routes answer "Stakeholders need a database update" (503), the pickers fall back to plain text, and every other feature is unaffected. The feature can also be switched off any time in Admin, Feature switches ("People directory").

## Apply 4_planned_meetings (Phase 13)

Additive only: three new tables (`MeetingSeries`, `PlannedMeeting`, `PlannedAttendee`) with indexes, two unique indexes (`PlannedMeeting.meetingId`, `PlannedMeeting.bookingId`) and cascade or set-null foreign keys. The `Meeting` table and every existing column are untouched.

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production.
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the app still works: the plan routes answer "Planning needs a database update" (503), the Upcoming list, the Next up card and the Planned meeting card stay hidden, a new booking is still created (its plan is skipped), and AI minutes use the old prompt. The feature can also be switched off any time in Admin, Feature switches ("Planned meetings and series"): the routes answer "Planning is paused" and the entry points disappear.

## Apply 5_prework (Phase 14)

Additive only: one new table (`PlanReference`: the extracted text of a reference file plus its AI points, soft-deleted via `deletedAt`) with an index and a cascade foreign key to `PlannedMeeting`. Nothing existing changes. The uploaded files themselves are never stored.

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production.
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the app still works: the reference routes answer "Pre-work needs a database update" (503) and the Pre-work section and the reference list on the meeting page stay hidden. The feature can also be switched off any time in Admin, Feature switches ("Pre-work"): the routes answer "Pre-work is paused" and the section disappears. Plans themselves are unaffected either way.

## Apply 6_calendar (Phase 15)

Additive only: four new columns, each with a default or NULL (`User.shareFreeBusy` false, `MeetingSeries.keepAhead` 0, `PlannedMeeting.icsSequence` 0, `PlannedAttendee.invitedAt` NULL) and one unique index `PlannedMeeting(seriesId, startAt)` that stops a series from getting two meetings at the same time. Plans without a series have a NULL `seriesId`, which Postgres allows any number of times. No table is created, changed in meaning or dropped.

The migration begins the index with a safety step: if two plans in one series ever shared the exact same start time, the later ones are moved by 1 millisecond each so the index can be built. With no such duplicates (the normal case) it changes nothing. To check first: `SELECT "seriesId", "startAt", count(*) FROM "PlannedMeeting" WHERE "seriesId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;`

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production.
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the app still works exactly as before: every new route (`/api/freebusy`, `/api/calendar/*`, `/api/plans/[id]/calendar`, `/api/plans/[id]/invite`, `/api/series/[id]/keep-ahead`) answers "Calendar needs a database update" (503), Find a time, the conflict warning, invites, Series settings and the Profile sharing switch stay hidden, public booking ignores planned meetings, and a plan's .ics is the same file as before. The feature can also be switched off any time in Admin, Feature switches ("Calendar"). Email invites need `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` (the same ones booking emails use); without them the invite button becomes "Share invite file".

## Apply 7_tracker (Phase 16)

Additive only: one new nullable column, `ActionItem.ownerStakeholderId` (TEXT, no default, no index, no foreign key). No table is created, changed in meaning or dropped, and existing rows are untouched.

1. On a Neon preview branch first: `npx prisma migrate deploy` with that branch's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. After the pull request is merged, the same command against production.
3. `npm run db:status` should say "Database schema is up to date".

Until it is applied the tracker behaves exactly as before: every task query falls back to the old columns when the database says the new one is missing (P2022), owners stay plain text, the series chip, "Link owners to People" and the owner-by-person filter do not appear. The switch-only parts (Timeline view, the Tasks badge, the daily reminder, the Record line, Series progress) need no new column and work straight away. The whole set can be switched off any time in Admin, Feature switches ("Tracker upgrades"); the task list then returns exactly the old fields.

### Brand new databases (for example a fresh Neon preview branch)

A Neon branch copied from production already has the tables and the `_prisma_migrations` rows, so nothing to do after the baseline above. For a completely empty database just run `npm run db:migrate` (applies `0_init`, `1_safety`, `2_history`, `3_stakeholders`, `4_planned_meetings`, `5_prework`, `6_calendar`, then `7_tracker`).

## From now on

- Never run `prisma db push` against production.
- A schema change is a new migration folder (`2_name`, `3_name`...):
  1. Point `DATABASE_URL` / `DATABASE_URL_UNPOOLED` at a **Neon dev branch** (never production).
  2. Edit `prisma/schema.prisma`.
  3. `npx prisma migrate dev --name short_name` (creates the folder and applies it to the dev branch). Or offline: `npx prisma migrate diff --from-schema-datamodel <old schema> --to-schema-datamodel prisma/schema.prisma --script` and save the SQL as `prisma/migrations/<n>_<name>/migration.sql`.
  4. Commit the folder with the code. The pull request preview runs against the preview Neon branch; apply the migration there with `npm run db:migrate` before testing.
  5. After the owner approves and the code is merged, run `npm run db:migrate` against production.
- Write migrations additively (new tables, new nullable columns) so the old app version keeps working while the new one rolls out. The app already tolerates missing tables and columns (P2021/P2022 handling).
- `npm run db:status` shows which migrations are applied.
