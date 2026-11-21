import { notFound, redirect } from "next/navigation";
import { MEETING_ID_RE } from "@/lib/meetingId";

// Old /meetings/<id> links (Phase 1/2 deep links) land on the static meeting shell.
export default async function MeetingRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!MEETING_ID_RE.test(id)) notFound();
  redirect(`/meeting?id=${id}`);
}
