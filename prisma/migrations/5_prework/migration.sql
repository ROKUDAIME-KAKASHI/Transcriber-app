-- CreateTable
CREATE TABLE "PlanReference" (
    "id" TEXT NOT NULL,
    "plannedMeetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "points" JSONB,
    "summarizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlanReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanReference_plannedMeetingId_idx" ON "PlanReference"("plannedMeetingId");

-- AddForeignKey
ALTER TABLE "PlanReference" ADD CONSTRAINT "PlanReference_plannedMeetingId_fkey" FOREIGN KEY ("plannedMeetingId") REFERENCES "PlannedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

