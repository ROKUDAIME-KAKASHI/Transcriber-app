"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Smartphone, Monitor, FileText, Radio, AudioLines, ChevronRight, Mic } from "lucide-react";
import { LANGUAGES, formatDuration } from "@/lib/transcript";

export interface MeetingRow {
  id: string;
  title: string;
  status: string;
  language: string;
  durationSec: number;
  deviceName: string | null;
  template: string | null;
  createdAt: string;
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

export function MeetingList({ meetings }: { meetings: MeetingRow[] }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? meetings.filter((m) => m.title.toLowerCase().includes(q)) : meetings;
    const out: { label: string; items: MeetingRow[] }[] = [];
    for (const m of shown) {
      const label = dayLabel(new Date(m.createdAt));
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [meetings, query]);

  if (meetings.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card p-10 sm:p-14 text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center">
          <AudioLines className="w-7 h-7" />
        </span>
        <p className="mt-4 font-semibold">No meetings yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Recordings from your phone and laptop will show up here.</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-accent text-accent-foreground px-5 py-2.5 font-semibold"
        >
          <Mic className="w-4 h-4" /> Record your first meeting
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <label className="relative block">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <span className="sr-only">Search meetings</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title"
          className="w-full rounded-2xl border border-border bg-card shadow-card pl-10 pr-4 py-3 text-base sm:text-sm outline-none focus:border-accent"
        />
      </label>

      {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No meetings match “{query}”.</p>}

      {groups.map((g) => (
        <section key={g.label}>
          <h2 suppressHydrationWarning className="px-1 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h2>
          <ul className="rounded-3xl border border-border bg-card shadow-card divide-y divide-border overflow-hidden">
            {g.items.map((m) => {
              const isPhone = /iPhone|iPad|Android/i.test(m.deviceName ?? "");
              const DeviceIcon = isPhone ? Smartphone : Monitor;
              const live = m.status === "RECORDING";
              const Icon = live ? Radio : m.template ? FileText : AudioLines;
              return (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="flex items-center gap-3.5 px-4 sm:px-5 py-3.5 hover:bg-muted/60 transition-colors">
                    <span
                      className={`w-10 h-10 shrink-0 rounded-xl grid place-items-center ${
                        live ? "bg-danger/10 text-danger" : m.template ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-medium truncate">{m.title}</span>
                        {live && (
                          <span className="shrink-0 rounded-full bg-danger/10 text-danger px-1.5 py-px text-[10px] font-bold uppercase tracking-wider">
                            Live
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span suppressHydrationWarning>{new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
                        <span className="tabular-nums">{formatDuration(m.durationSec)}</span>
                        <span className="hidden sm:inline">{LANGUAGES.find((l) => l.value === m.language)?.label ?? m.language}</span>
                        {m.deviceName && (
                          <span className="inline-flex items-center gap-1">
                            <DeviceIcon className="w-3.5 h-3.5" /> {m.deviceName}
                          </span>
                        )}
                        {m.template && !live && (
                          <span className="text-accent font-medium">{m.template === "Report" ? "Report ready" : "Minutes ready"}</span>
                        )}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
