import { notFound, redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { MeetingView } from "@/components/MeetingView";
import { parseTranscript } from "@/lib/transcript";
import { MEETING_FULL_SELECT, MEETING_FULL_SELECT_LEGACY, withLegacyFallback } from "@/lib/meetingSelect";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const { id } = await params;

  const meeting = await withLegacyFallback((legacy) =>
    prisma.meeting.findFirst({
      where: { id, userId },
      select: legacy ? MEETING_FULL_SELECT_LEGACY : MEETING_FULL_SELECT,
    }),
  );
  if (!meeting) notFound();

  return (
    <AppShell>
      <MeetingView
        meeting={{
          id: meeting.id,
          title: meeting.title,
          status: meeting.status,
          language: meeting.language,
          durationSec: meeting.durationSec,
          deviceName: meeting.deviceName,
          template: meeting.template,
          document: meeting.document,
          createdAt: meeting.createdAt.toISOString(),
          transcript: parseTranscript(meeting.transcript),
        }}
      />
    </AppShell>
  );
}
