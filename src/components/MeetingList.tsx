"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { listMeetings, listPending } from "@/lib/local/repo";
import { getSyncSnapshot, subscribeSync } from "@/lib/local/sync";
import { MeetingSkeleton } from "./MeetingLoader";
import { useLocalUser } from "./SyncProvider";
import { Search, Smartphone, Monitor, ChevronRight, Mic } from "lucide-react";
import { formatDuration } from "@/lib/transcript";
import { Badge, LiveDot, cx, inputCls } from "./ui";

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
}

function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: today.getFullYear() === d.getFullYear() ? undefined : "numeric" });
}

function StatusBadge({ m }: { m: MeetingRow }) {
  if (m.status === "RECORDING") {
    return (
      <Badge tone="live">
        <LiveDot /> Live
      </Badge>
    );
  }
  if (m.template) return <Badge tone="success">{m.template === "Report" ? "Report" : "Minutes"}</Badge>;
  return null; // plain transcript: no badge, so the ones that matter stand out
}

function SyncBadge({ m }: { m: MeetingRow }) {
  if (m.sync === "pending") return <Badge tone="neutral">Not synced yet</Badge>;
  if (m.sync === "error") return <Badge tone="live">Couldn't sync</Badge>;
  return null;
}

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
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [local]);

  const [query, setQuery] = useState("");
  // Day headings and times depend on the viewer's timezone, so they only appear after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? merged.filter((m) => m.title.toLowerCase().includes(q)) : merged;
    if (!mounted) return [{ label: "", items: shown }];
    const out: { label: string; items: MeetingRow[] }[] = [];
    for (const m of shown) {
      const label = dayLabel(new Date(m.createdAt));
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [merged, query, mounted]);

  const header = (
    <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Meetings</h1>
        <p className="mt-1 text-meta text-muted-foreground">
          {merged.length === 0
            ? "Recordings from all your devices."
            : `${merged.length} recording${merged.length === 1 ? "" : "s"} from all your devices`}
        </p>
      </div>
      <Link
        href="/"
        className="hidden min-h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90 sm:inline-flex"
      >
        <Mic className="h-4 w-4" /> New recording
      </Link>
    </div>
  );

  // No local DB (blocked storage / private mode): say so instead of a misleading empty list.
  if (mounted && !available) {
    return (
      <>
        {header}
        <div role="status" className="rounded-panel border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-ui font-semibold">This browser can't store meetings offline</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-meta text-muted-foreground">
            Local storage is blocked here (private mode?). Open Transcriber in a normal window to see and sync your meetings.
          </p>
        </div>
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
        <div className="rounded-panel border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-ui font-semibold">No meetings yet</p>
          <p className="mx-auto mt-1 max-w-[40ch] text-meta text-muted-foreground">
            Recordings from your phone and laptop appear here, with their transcripts and minutes.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90"
          >
            <Mic className="h-4 w-4" /> Record a meeting
          </Link>
        </div>
      </>
    );
  }

  const nothingMatches = groups.every((g) => g.items.length === 0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Search meetings</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search meetings"
          className={cx(inputCls, "pl-10")}
        />
      </label>

      {nothingMatches && <p className="py-10 text-center text-ui text-muted-foreground">No meetings match “{query}”.</p>}

      {groups.map((g, gi) =>
        g.items.length === 0 ? null : (
          <section key={g.label || gi}>
            {g.label && (
              <h2 suppressHydrationWarning className="mb-2 px-1 text-meta font-medium text-muted-foreground">
                {g.label}
              </h2>
            )}
            <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-card">
              {g.items.map((m) => {
                const isPhone = /iPhone|iPad|Android/i.test(m.deviceName ?? "");
                const DeviceIcon = isPhone ? Smartphone : Monitor;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/meeting?id=${m.id}`}
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_4.5rem_1rem] sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-ui font-medium">{m.title}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-3 text-meta text-muted-foreground">
                          {mounted && (
                            <span className="shrink-0 whitespace-nowrap sm:hidden" suppressHydrationWarning>
                              {time(m.createdAt)}
                            </span>
                          )}
                          <span className="shrink-0 whitespace-nowrap tabular-nums sm:hidden">{formatDuration(m.durationSec)}</span>
                          {m.deviceName && (
                            <span className="inline-flex min-w-0 items-center gap-1 truncate">
                              <DeviceIcon className="h-3.5 w-3.5 shrink-0" /> {m.deviceName}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="sm:justify-self-start">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge m={m} />
                          <SyncBadge m={m} />
                        </span>
                      </span>
                      <span className="hidden text-right text-meta tabular-nums text-muted-foreground sm:block">
                        {formatDuration(m.durationSec)}
                      </span>
                      <span className="hidden whitespace-nowrap text-right text-meta tabular-nums text-muted-foreground sm:block" suppressHydrationWarning>
                        {mounted ? time(m.createdAt) : ""}
                      </span>
                      <ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
