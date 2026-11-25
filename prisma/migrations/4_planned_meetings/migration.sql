-- CreateTable
CREATE TABLE "MeetingSeries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'NONE',
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
    "defaultVenue" TEXT,
    "defaultCallUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedMeeting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "venue" TEXT,
    "callUrl" TEXT,
    "agenda" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "meetingId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlannedMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedAttendee" (
    "id" TEXT NOT NULL,
    "plannedMeetingId" TEXT NOT NULL,
    "stakeholderId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "designation" TEXT,
    "role" TEXT,

    CONSTRAINT "PlannedAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingSeries_userId_idx" ON "MeetingSeries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedMeeting_meetingId_key" ON "PlannedMeeting"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedMeeting_bookingId_key" ON "PlannedMeeting"("bookingId");

-- CreateIndex
CREATE INDEX "PlannedMeeting_userId_startAt_idx" ON "PlannedMeeting"("userId", "startAt");

-- CreateIndex
CREATE INDEX "PlannedAttendee_plannedMeetingId_idx" ON "PlannedAttendee"("plannedMeetingId");

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedMeeting" ADD CONSTRAINT "PlannedMeeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedMeeting" ADD CONSTRAINT "PlannedMeeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MeetingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedAttendee" ADD CONSTRAINT "PlannedAttendee_plannedMeetingId_fkey" FOREIGN KEY ("plannedMeetingId") REFERENCES "PlannedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

