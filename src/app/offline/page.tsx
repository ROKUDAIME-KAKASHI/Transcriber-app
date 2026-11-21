import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Panel } from "@/components/ui";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Panel className="w-full px-6 py-12 text-center">
        <WifiOff className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">You&apos;re offline</h1>
        <p className="mx-auto mt-1 max-w-[40ch] text-meta text-muted-foreground">
          This page isn&apos;t saved on this device. Go back to Record or your meetings.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-ui font-semibold hover:bg-muted"
          >
            Open Record
          </Link>
          <Link
            href="/meetings"
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-ui font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Open meetings
          </Link>
        </div>
      </Panel>
    </main>
  );
}
