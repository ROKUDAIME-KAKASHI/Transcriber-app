-- Calendar (Phase 15). Additive: four new columns with defaults or NULL, plus one unique index.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "shareFreeBusy" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MeetingSeries" ADD COLUMN     "keepAhead" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlannedMeeting" ADD COLUMN     "icsSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlannedAttendee" ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- Safety net for the unique index below: if two plans in the same series ever shared the exact same start
-- time, nudge the later ones by 1 millisecond each (invisible in the app) so the index can be created.
-- With no such duplicates (the normal case) this changes nothing.
UPDATE "PlannedMeeting" p
SET "startAt" = p."startAt" + ((d.rn - 1) * INTERVAL '1 millisecond')
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "seriesId", "startAt" ORDER BY "createdAt", "id") AS rn
    FROM "PlannedMeeting"
    WHERE "seriesId" IS NOT NULL
) d
WHERE p."id" = d."id" AND d.rn > 1;

-- CreateIndex (plans without a series have a NULL seriesId; Postgres allows any number of those)
CREATE UNIQUE INDEX "PlannedMeeting_seriesId_startAt_key" ON "PlannedMeeting"("seriesId", "startAt");
