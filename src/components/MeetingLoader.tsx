"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileX } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { cacheServerMeeting, getMeeting } from "@/lib/local/repo";
import { useConnectivity } from "@/lib/connectivity";
import { resolveMeetingId } from "@/lib/meetingRoute";
import { parseTranscript, type TranscriptPart } from "@/lib/transcript";
import { MeetingView } from "./MeetingView";
import { useLocalUser } from "./SyncProvider";
import { Button, Panel } from "./ui";

interface Final {
  id: string;
  title: string;
  status: string;
  language: string;
  durationSec: number;
  deviceName: string | null;
  template: string | null;
  document: string | null;
  createdAt: string;
  updatedAt?: string;
  speakerNames?: Record<string, string> | null;
  transcript: TranscriptPart[];
}

type Remote =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "ok"; data: Final };

export function MeetingSkeleton() {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Loading</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="shimmer h-[88px] rounded-panel bg-muted" />
      ))}
    </div>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Panel as="div" className="px-6 py-12 text-center">
      <FileX className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-ui font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-[40ch] text-meta text-muted-foreground">{body}</p>
      {children}
    </Panel>
  );
}

const backLink = (
  <Link
    href="/meetings"
    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-ui font-medium hover:bg-muted"
  >
    Back to meetings
  </Link>
);

/** Meeting page body: device store first, then the server when reachable, else an honest "not on this device". */
export function MeetingLoader({ initialId }: { initialId?: string }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const qs = search.toString();
  const id = initialId ?? resolveMeetingId(qs ? `?${qs}` : "", pathname ?? "");
  const { userId } = useLocalUser();
  const conn = useConnectivity();
  const data = useLiveQuery(() => (userId && id ? getMeeting(userId, id) : null), [userId, id]);
  const [remote, setRemote] = useState<Remote>({ kind: "idle" });
  const [nonce, setNonce] = useState(0);
  // The session/user can resolve a moment after mount; without a user we go straight to the server.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const hasLocal = !!data && data.meeting.deleted !== 1 && data.meeting.hasTranscript !== false;
  const isDeleted = !!data && data.meeting.deleted === 1;
  const localFinal = data !== undefined && (userId !== null || waited);
  const online = conn !== "offline";

  useEffect(() => {
    setRemote({ kind: "idle" });
  }, [id]);

  useEffect(() => {
    if (!id || !localFinal || hasLocal || isDeleted || !online) return;
    let live = true;
    setRemote((r) => (r.kind === "idle" ? { kind: "loading" } : r));
    (async () => {
      try {
        const res = await fetch(`/api/meetings/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 401 || res.status === 403 || res.status === 404) return setRemote({ kind: "denied" });
        if (!res.ok) return setRemote({ kind: "error" });
        const { meeting } = await res.json();
        const transcript = parseTranscript(meeting.transcript);
        if (userId) await cacheServerMeeting(userId, { ...meeting, transcript });
        if (!live) return;
        setRemote({
          kind: "ok",
          data: {
            id: meeting.id,
            title: meeting.title,
            status: meeting.status,
            language: meeting.language,
            durationSec: meeting.durationSec,
            deviceName: meeting.deviceName,
            template: meeting.template,
            document: meeting.document,
            createdAt: meeting.createdAt,
            updatedAt: meeting.updatedAt,
            speakerNames: meeting.speakerNames && typeof meeting.speakerNames === "object" && !Array.isArray(meeting.speakerNames) ? meeting.speakerNames : null,
            transcript,
          },
        });
      } catch {
        if (live) setRemote({ kind: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, localFinal, hasLocal, isDeleted, online, nonce, userId]);

  const retry = useCallback(() => {
    setRemote({ kind: "idle" });
    setNonce((n) => n + 1);
  }, []);

  if (!id) {
    return (
      <Message title="Meeting not found" body="This link isn't a valid meeting.">
        {backLink}
      </Message>
    );
  }
  if (data === undefined || !localFinal) return <MeetingSkeleton />;

  if (isDeleted) {
    return (
      <Message title="Meeting not found" body="It may have been deleted, or it belongs to another account.">
        {backLink}
      </Message>
    );
  }

  if (hasLocal && data) {
    const m = data.meeting;
    return (
      <MeetingView
        key={id}
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
          speakerNames: m.speakerNames ?? null,
          transcript: data.parts,
        }}
      />
    );
  }

  if (remote.kind === "ok") return <MeetingView key={id} meeting={remote.data} />;
  if (online && (remote.kind === "loading" || remote.kind === "idle")) return <MeetingSkeleton />;
  if (remote.kind === "denied") {
    return (
      <Message title="Meeting not found" body="It may have been deleted, or it belongs to another account.">
        {backLink}
      </Message>
    );
  }
  if (remote.kind === "error" && online) {
    return (
      <Message title="Couldn't load this meeting. Try again." body="Check your connection and try again.">
        <Button variant="secondary" className="mt-5" onClick={retry}>
          Try again
        </Button>
      </Message>
    );
  }
  return (
    <Message title="Not on this device yet" body="Open this meeting once while online to keep a copy here.">
      {backLink}
    </Message>
  );
}
