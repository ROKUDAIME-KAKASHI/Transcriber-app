import Link from "next/link";
import { AudioLines } from "lucide-react";
import { Panel } from "@/components/ui";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Panel className="w-full px-6 py-12 text-center">
        <span className="mx-auto mb-4 grid h-7 w-7 place-items-center rounded-[10px] bg-accent text-accent-foreground" aria-hidden>
          <AudioLines className="h-4 w-4" />
        </span>
        <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mx-auto mt-1 max-w-[40ch] text-meta text-muted-foreground">
          This page isn&apos;t saved on this device. Go back to Record or your meetings.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-5 text-ui font-semibold text-accent-foreground"
          >
            Open Record
          </Link>
          <Link
            href="/meetings"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-border/70 bg-card px-5 text-ui font-semibold shadow-card"
          >
            Open meetings
          </Link>
        </div>
      </Panel>
    </main>
  );
}
