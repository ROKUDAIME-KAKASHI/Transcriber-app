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
      <div className="max-w-4xl">
        <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Meetings</h1>
            <p className="mt-1 text-meta text-muted-foreground">
              {meetings.length === 0
                ? "Recordings from all your devices."
                : `${meetings.length} recording${meetings.length === 1 ? "" : "s"} from all your devices`}
            </p>
          </div>
          <Link
            href="/"
            className="hidden min-h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-ui font-medium text-accent-foreground hover:bg-accent/90 sm:inline-flex"
          >
            <Mic className="h-4 w-4" /> New recording
          </Link>
        </div>
        <MeetingList meetings={meetings.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} />
      </div>
    </AppShell>
  );
}
