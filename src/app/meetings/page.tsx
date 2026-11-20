import Link from "next/link";
import { redirect } from "next/navigation";
import { Mic } from "lucide-react";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { MeetingList } from "@/components/MeetingList";

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
      <div className="max-w-3xl">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Meetings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {meetings.length === 0
                ? "Recordings from all your devices."
                : `${meetings.length} recording${meetings.length === 1 ? "" : "s"} from all your devices, newest first.`}
            </p>
          </div>
          <Link
            href="/"
            className="hidden sm:inline-flex shrink-0 items-center gap-2 rounded-2xl bg-accent text-accent-foreground px-4 py-2.5 text-sm font-semibold shadow-card"
          >
            <Mic className="w-4 h-4" /> New recording
          </Link>
        </div>
        <MeetingList meetings={meetings.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} />
      </div>
    </AppShell>
  );
}
