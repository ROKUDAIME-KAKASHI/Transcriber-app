# Database migrations

Until now the schema was applied with `prisma db push`. From now on every schema change is a tracked migration folder under `prisma/migrations/`, so a preview database, a dev branch and production can all be brought to exactly the same shape.

## What is in the repo

| Folder | What it creates |
|--------|-----------------|
| `prisma/migrations/0_init` | The whole schema as it is on the live database today (User, Meeting, ActionItem, Availability, EventType, Booking, AgendaDraft) |
| `prisma/migrations/1_safety` | New Step-0 tables: `ClientError` (error log) and `FeatureFlag` (feature switches) |
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

### Brand new databases (for example a fresh Neon preview branch)

A Neon branch copied from production already has the tables and the `_prisma_migrations` rows, so nothing to do after the baseline above. For a completely empty database just run `npm run db:migrate` (applies `0_init` then `1_safety`).

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
