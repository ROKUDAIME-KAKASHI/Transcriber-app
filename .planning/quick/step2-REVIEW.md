# Step 2 (Phase 12 Stakeholders) review

Scope: `git diff main..step-2-stakeholders`. Result: no critical or high issues; no code changes needed.

## Checked and OK
- Owner scoping: every route (list, create, patch, delete, import, suggestions) filters by session `userId`; patch/delete use `updateMany({id,userId,deletedAt:null})`, so another user's id gives 404. Suggestions read only `actionItem.userId`, `meeting.userId`, `booking.hostUserId` for the current user, and return only that user's own strings.
- Soft delete: all reads and duplicate checks use `deletedAt: null`.
- Flag-off and missing table: all routes return 503 (paused, or P2021/P2022 message). Zod caps are present (name 100, notes 2000, email 200, import 200).
- Migration `3_stakeholders`: regenerated with `prisma migrate diff` from main's schema, output identical, additive only, no DB connection.
- PersonPicker: falls back to a plain input (no combobox role) when the flag is off, offline, or the table is missing. Keyboard (Up/Down/Enter/Escape) and combobox/listbox/option roles are correct. Escape only stops propagation when the list is open. There is no focus trap. Options use `mousedown preventDefault`, so no blur-save fires before the pick.
- Double save on select then blur: effectively deduped. TaskTracker patches optimistically, so `item.owner` already equals the picked name when blur runs `saveOwner`, which then no-ops.
- Clipping: the list is `absolute` inside a `relative` wrapper. No `overflow` ancestor was found in TaskTracker or ActionItems, so no portal is needed.
- RenameSpeakerSheet: suggestion chips only call `setValue`, so the normal rename path is unchanged.
- SW: `/people` is added to both the routing and build shell lists, and the routing test is updated. The tab bar is unchanged (4 items). The People entry is in the sidebar and in Profile.

## Findings (not fixed)
- WARNING (medium): email uniqueness is checked in code only. Two concurrent creates with the same email can both pass the check, because there is no DB constraint. Impact is low (a single user's own directory, a manual double-submit). A fix needs a partial unique index `(userId, lower(email)) WHERE deletedAt IS NULL` in a new migration, which Prisma can't express in the schema. Accepted for now.
- INFO: `GET /api/stakeholders` has `take: 1000` and `livePeople` has `take: 5000`. Past those limits the list and duplicate checks are silently truncated.
- INFO: PATCH re-reads the person after `updateMany`. If a concurrent delete lands between the two, it returns `{person: null}` with a 200.
- INFO: the picker list opens on focus with an empty value and shows the first 8 people. This is fine but a little noisy on mobile.

## Verification
`npx prisma validate`, `npx tsc --noEmit` and `npm test` (365 pass) all pass. The build was not rerun because no source changed.
