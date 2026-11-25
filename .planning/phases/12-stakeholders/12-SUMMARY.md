# Phase 12: Stakeholders directory - Summary

**Status:** Complete in code, needs UAT and `3_stakeholders` applied.
**Requirements:** STK-01, STK-02
**Flag:** `stakeholders` (default on), Admin > Feature switches > "People directory".

## What was built

- **Model** `Stakeholder` (name, designation, organisation, area, email, phone, notes, `deletedAt`), index `(userId, name)`, cascade FK to `User`. Migration `prisma/migrations/3_stakeholders/migration.sql` generated offline with `prisma migrate diff` from the main schema. Additive only.
- **Duplicates:** email is unique per user in code (case-insensitive, hard 409). A name at least 0.85 similar (reuses `dedupe.similarity`) gives a "Possible duplicate" 409 that the user can override with Save anyway (`force`).
- **API** (owner-scoped, zod caps, `no-store`, 503 "Stakeholders need a database update" on P2021/P2022, 503 "paused" when the flag is off): `GET/POST /api/stakeholders`, `PATCH/DELETE /api/stakeholders/[id]` (soft delete), `POST /api/stakeholders/import` (up to 200, skips duplicate emails, returns `{created, skipped}`), `GET /api/stakeholders/suggestions`.
- **People page** `/people`: search, alphabetical groups, name / designation · organisation / email / area chip, tap to edit in a sheet, Add person, empty state, "Add from your meetings" chips (task owners, renamed speakers, booking guests with email). Online-only notice like `/tasks`. Entry points: Profile "People" row and the laptop sidebar. No new phone tab.
- **PersonPicker** (combobox, keyboard and screen reader): used for task Owner in the tracker and the extraction review, with "Add 'X' as new person". Rename speaker sheet shows matching directory names as chips. Stored data is still the name string. With the flag off, offline, or the table missing, all of these are plain text fields as before.
- **Service worker:** `/people` added as a static shell (`sw/routing.js`, `sw/build.mjs`, routing test).
- **Tests:** `tests/stakeholders.test.ts` (validation, duplicates, search, grouping, picker, suggestions).

## Deletion safety

Delete sets `deletedAt`. Tasks and meetings only store the name text, so nothing that mentions the person changes (success criterion 3).

## Deviations

- Added `GET /api/stakeholders/suggestions` (not in the original list) to power "Add from your meetings".
- Search on the People page filters the loaded list on the client; the API `?q=` is also supported (used by other callers).
- Picker "Add as new person" does not create a second record when the server says it is a likely duplicate; it keeps the typed name and shows why.

## Not done / later

- Owners are not linked to stakeholders yet (Phase 16).
- No offline cache of the directory.

## Verification run

`npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit`, `npm test`, `npm run build` (CI placeholder env), `npm run check-build`: all pass. UI not exercised in a browser or on a device.
