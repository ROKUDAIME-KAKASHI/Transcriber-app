"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getMeeting } from "@/lib/local/repo";
import { MeetingView } from "./MeetingView";
import { useLocalUser } from "./SyncProvider";

/** Renders a meeting from this device's store, for meetings the server doesn't have (yet). */
export function LocalMeetingView({ id }: { id: string }) {
  const { userId } = useLocalUser();
  const data = useLiveQuery(() => (userId ? getMeeting(userId, id) : null), [userId, id]);

  if (data === undefined) {
    return <p className="py-10 text-center text-ui text-muted-foreground">Loading…</p>;
  }
  if (!data || data.meeting.deleted === 1) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-card px-6 py-14 text-center">
        <p className="text-ui font-semibold">Meeting not found</p>
        <p className="mx-auto mt-1 max-w-[40ch] text-meta text-muted-foreground">
          It may have been deleted, or it belongs to another account.
        </p>
        <Link
          href="/meetings"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90"
        >
          Back to meetings
        </Link>
      </div>
    );
  }
  const m = data.meeting;
  return (
    <MeetingView
      source="local"
      meeting={{
        id: m.id,
        title: m.title,
        status: m.status,
        language: m.language,
        durationSec: m.durationSec,
        deviceName: m.deviceName,
        template: m.template,
        document: m.document,
        createdAt: m.createdAt,
        transcript: data.parts,
      }}
    />
  );
}
