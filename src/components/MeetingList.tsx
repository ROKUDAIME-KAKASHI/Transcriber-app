"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { listMeetings, listPending, setTitle as setLocalTitle, tombstone } from "@/lib/local/repo";
import { stopRecordingRemotely } from "@/lib/local/stopRemote";
import { canStopFromList, isStaleRecording, stopConfirmText, type MeetingOrigin } from "@/lib/recordingState";
import { getSyncSnapshot, isRecordingId, poke, subscribeSync } from "@/lib/local/sync";
import { MeetingSkeleton } from "./MeetingLoader";
import { UpcomingPlans } from "./UpcomingPlans";
import { useLocalUser } from "./SyncProvider";
import { Search, Mic, Loader2 } from "lucide-react";
import { formatDuration } from "@/lib/transcript";
import { filterMeetings, formatHours, groupMeetings, listStats } from "@/lib/meetingListView";
import { discardNativeAudio } from "@/lib/nativeRecorder";
import { findDuplicateMeetings } from "@/lib/dedupe";
import { useToast } from "./Toast";
import { Badge, Button, LiveDot, Panel, cx, inputCls } from "./ui";
import { DeleteDialog, RenameDialog, RowMenu } from "./MeetingRowActions";

export interface MeetingRow {
  id: string;
  title: string;
  status: string;
  language: string;
  durationSec: number;
  deviceName: string | null;
  template: string | null;
  createdAt: string;
  sync?: "pending" | "error" | null;
  origin?: MeetingOrigin;
  lastWriteAt?: number;
  serverUpdatedAt?: string | null;
  /** Recorded offline on this phone and not finished: the transcript is completed on the Record screen. */
  nativeCapture?: boolean;
  /** Minutes or a report exist (from the loaded list data). */
  hasMinutes?: boolean;
}

/** At most one chip per row: what needs attention first, else the nicest thing to know. Plain words, no jargon. */
function RowChip({ m, stale, syncing, duplicate }: { m: MeetingRow; stale: boolean; syncing: boolean; duplicate: boolean }) {
  if (m.status === "RECORDING" && m.nativeCapture && stale) return <Badge tone="warning">Needs finishing</Badge>;
  if (m.status === "RECORDING" && stale) return <Badge tone="warning">Not responding</Badge>;
  if (m.status === "RECORDING") {
    return (
      <Badge tone="live">
        <LiveDot /> Live
      </Badge>
    );
  }
  if (m.sync === "error") return <Badge tone="danger">Couldn’t upload</Badge>;
  if (m.sync === "pending" && syncing) {
    return (
      <Badge tone="neutral">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Uploading…
      </Badge>
    );
  }
  if (m.sync === "pending") return <Badge tone="warning">Not uploaded yet</Badge>;
  if (duplicate) return <Badge tone="warning">Possible duplicate</Badge>;
  return null;
}

const pillLink =
  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-accent px-5 text-ui font-medium text-accent-foreground hover:bg-accent/90";

export function MeetingList() {
  const { userId, available } = useLocalUser();
  const local = useLiveQuery(
    async () =>
      userId
        ? {
            rows: await listMeetings(userId),
            tombstones: (await listPending(userId)).filter((m) => m.deleted === 1).map((m) => m.id),
          }
        : null,
    [userId],
  );
  const sync = useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot);

  // Every non-deleted device row (including ones pulled from the server); badges only for unsynced ones.
  const merged = useMemo<MeetingRow[]>(() => {
    if (!local) return [];
    const dead = new Set(local.tombstones);
    const syncOf = (l: { syncError: string | null }) => (l.syncError ? "error" : "pending") as "error" | "pending";
    const out: MeetingRow[] = [];
    for (const l of local.rows) {
      if (dead.has(l.id)) continue;
      out.push({
        id: l.id,
        title: l.title,
        status: l.status,
        language: l.language,
        durationSec: l.durationSec ?? 0,
        deviceName: l.deviceName ?? null,
        template: l.template ?? null,
        createdAt: l.createdAt,
        sync: l.pending === 1 ? syncOf(l) : null,
        origin: l.origin,
        lastWriteAt: l.lastWriteAt,
        serverUpdatedAt: l.serverUpdatedAt,
        nativeCapture: l.nativeCapture === 1,
        hasMinutes: !!(l.template || l.document),
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [local]);

  // Tag only: two meetings with the same title, start and length are probably one recording saved twice.
  const dupIds = useMemo(() => findDuplicateMeetings(merged), [merged]);

  const toast = useToast();
  const router = useRouter();
  // Re-check "Not responding" as time passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const [stopping, setStopping] = useState<string | null>(null);
  const stopRecording = async (m: MeetingRow) => {
    if (stopping || !window.confirm(stopConfirmText(m.deviceName))) return;
    setStopping(m.id);
    const r = await stopRecordingRemotely(userId, m.id);
    setStopping(null);
    if (r === "finish-here") {
      toast("Finishing the transcript on this phone");
      router.push("/");
    } else if (r === "ok") toast("Recording stopped");
    else toast(r === "auth" ? "Signed out. Sign in again to stop it." : "Couldn't stop it. Check the connection and try again.", "danger");
  };

  const [query, setQuery] = useState("");
  // Group headings and times depend on the viewer's timezone, so they only appear after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const groups = useMemo(
    () => groupMeetings(filterMeetings(merged, query), mounted ? new Date() : null),
    [merged, query, mounted],
  );
  const stats = useMemo(() => (mounted ? listStats(merged, new Date()) : null), [merged, mounted]);

  const [renaming, setRenaming] = useState<MeetingRow | null>(null);
  const [deleting, setDeleting] = useState<MeetingRow | null>(null);
  // Same offline-first paths MeetingView uses: write locally and let sync push it, else call the API.
  const renameMeeting = async (m: MeetingRow, title: string): Promise<boolean> => {
    if (userId && (await setLocalTitle(userId, m.id, title))) {
      poke(m.id);
      return true;
    }
    try {
      const res = await fetch(`/api/meetings/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const deleteMeeting = async (m: MeetingRow): Promise<boolean> => {
    if (userId && (await tombstone(userId, m.id))) {
      void discardNativeAudio(m.id);
      poke(m.id);
      return true;
    }
    return false;
  };

  const header = (
    <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="mt-1 text-meta text-muted-foreground">
          Your conversations, organised and ready to revisit.
        </p>
        {stats && stats.total > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground" suppressHydrationWarning>
            <span><span className="num text-foreground">{stats.total}</span> meeting{stats.total === 1 ? "" : "s"}</span>
            {stats.hours !== null && <span><span className="num text-foreground">{formatHours(stats.hours)}</span> recorded</span>}
            {stats.thisWeek !== null && <span><span className="num text-foreground">{stats.thisWeek}</span> this week</span>}
          </p>
        )}
      </div>
      <Link href="/" className={cx(pillLink, "hidden sm:inline-flex")}>
        <Mic className="h-4 w-4" /> New recording
      </Link>
    </div>
  );

  // No local DB (blocked storage / private mode): say so instead of a misleading empty list.
  if (mounted && !available) {
    return (
      <>
        {header}
        <Panel as="div" role="status" className="px-6 py-12 text-center">
          <p className="text-ui font-semibold">This browser can't store meetings offline</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-meta text-muted-foreground">
            Local storage is blocked here (private mode?). Open Minutely in a normal window to see and sync your meetings.
          </p>
        </Panel>
      </>
    );
  }

  // Until the signed-in user id is known the list is loading, not empty.
  if (local === undefined || !userId) {
    return (
      <>
        {header}
        <MeetingSkeleton />
      </>
    );
  }

  if (merged.length === 0) {
    if (sync.state === "syncing" && sync.lastSyncedAt === null) {
      return (
        <>
          {header}
          <p className="sr-only" role="status">Loading your meetings</p>
          <MeetingSkeleton />
        </>
      );
    }
    return (
      <>
        {header}
        <UpcomingPlans className="mb-6" />
        <Panel as="div" className="px-6 py-12 text-center">
          <div aria-hidden className="relative mx-auto h-40 w-40">
            <div className="glass absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full">
              <Mic className="h-7 w-7 text-accent-text" />
            </div>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">No meetings yet</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-ui text-muted-foreground">No meetings yet. Press Record to capture your first one.</p>
          <Link href="/" className={cx(pillLink, "mt-6")}>
            <Mic className="h-4 w-4" /> Start recording
          </Link>
        </Panel>
      </>
    );
  }

  const nothingMatches = groups.every((g) => g.items.length === 0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  let index = 0;

  return (
    <div className="space-y-6">
      <UpcomingPlans />
      <label className="relative block">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Search meetings</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search meetings"
          className={cx(inputCls, "h-12 rounded-full pl-11")}
        />
      </label>

      {nothingMatches && (
        <div className="py-10 text-center">
          <p className="text-ui text-muted-foreground">No meetings match “{query.trim()}”.</p>
          <Button variant="ghost" className="mt-3" onClick={() => setQuery("")}>
            Clear
          </Button>
        </div>
      )}

      {groups.map((g, gi) =>
        g.items.length === 0 ? null : (
          <section key={g.label || gi}>
            {g.label && (
              <h2
                suppressHydrationWarning
                className="sticky top-14 z-10 mb-2 bg-background/90 px-1 py-2 text-meta font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:top-0"
              >
                {g.label}
              </h2>
            )}
            <ul className="divide-y divide-border/70 rounded-panel border border-border/70 bg-card">
              {g.items.map((m) => {
                const idx = index++;
                const stale = isStaleRecording(m, now);
                const canStop = canStopFromList({
                  status: m.status,
                  origin: m.origin ?? "server",
                  activeHere: isRecordingId(m.id),
                  stale,
                });
                return (
                  <li key={m.id} className="relative stagger-item first:[&>a]:rounded-t-panel last:[&>a]:rounded-b-panel" style={{ "--i": idx } as CSSProperties}>
                    <Link
                      href={`/meeting?id=${m.id}`}
                      className="block min-h-14 px-4 py-3 pr-14 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                    >
                      <span className="block truncate text-ui font-semibold">{m.title}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta num text-muted-foreground" suppressHydrationWarning>
                        {mounted && <span className="shrink-0 whitespace-nowrap">{day(m.createdAt)} · {time(m.createdAt)} ·</span>}
                        <span className="shrink-0 whitespace-nowrap">{formatDuration(m.durationSec)}</span>
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
                        <RowChip m={m} stale={stale} syncing={sync.state === "syncing"} duplicate={dupIds.has(m.id)} />
                        {m.hasMinutes && <Badge tone="accent">{m.template === "Report" ? "Report ready" : "Minutes ready"}</Badge>}
                      </span>
                    </Link>
                    <RowMenu title={m.title} canDelete={m.status !== "RECORDING"} onRename={() => setRenaming(m)} onDelete={() => setDeleting(m)} />
                    {canStop && (
                      <div className="flex items-center justify-end gap-3 px-4 pb-3">
                        {stale && (
                          <span className="text-meta text-muted-foreground">
                            {m.nativeCapture ? "Recorded on this phone. Stop it to finish the transcript." : "No update for a while. It may be stuck."}
                          </span>
                        )}
                        <Button variant="danger" onClick={() => stopRecording(m)} disabled={stopping === m.id}>
                          {stopping === m.id ? "Stopping…" : "Stop recording"}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
      {renaming && <RenameDialog title={renaming.title} onSave={(t) => renameMeeting(renaming, t)} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteDialog title={deleting.title} onConfirm={() => deleteMeeting(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
