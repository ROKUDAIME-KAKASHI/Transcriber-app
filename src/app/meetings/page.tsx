import Link from "next/link";
import { redirect } from "next/navigation";
import { Smartphone, Monitor, FileText, Radio } from "lucide-react";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { LANGUAGES, formatDuration } from "@/lib/transcript";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const meetings = await prisma.meeting.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, status: true, language: true, durationSec: true,
      deviceName: true, template: true, createdAt: true,
    },
  });

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Your meetings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Recordings from all your devices, newest first.
        </p>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <p>No meetings yet.</p>
          <Link href="/" className="inline-block mt-3 text-accent font-semibold">Record your first one →</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => {
            const isPhone = /iPhone|iPad|Android/i.test(m.deviceName ?? "");
            const DeviceIcon = isPhone ? Smartphone : Monitor;
            return (
              <li key={m.id}>
                <Link
                  href={`/meetings/${m.id}`}
                  className="block rounded-2xl border border-border bg-card p-4 hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold leading-snug min-w-0 break-words">{m.title}</h2>
                    {m.status === "RECORDING" ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-danger">
                        <Radio className="w-3.5 h-3.5" /> Live
                      </span>
                    ) : m.template ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                        <FileText className="w-3.5 h-3.5" /> {m.template === "Report" ? "Report" : "Minutes"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{m.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span className="tabular-nums">{formatDuration(m.durationSec)}</span>
                    <span>{LANGUAGES.find((l) => l.value === m.language)?.label ?? m.language}</span>
                    {m.deviceName && (
                      <span className="inline-flex items-center gap-1">
                        <DeviceIcon className="w-3.5 h-3.5" /> {m.deviceName}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
