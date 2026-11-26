import type { Metadata } from "next";
import { AudioLines } from "lucide-react";
import { PublicNotice } from "@/components/PublicNotice";
import { isFlagOn } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Book a time | Minutely",
  robots: { index: false, follow: false },
  // Confirmation links carry a secret token in the URL; never leak it through the Referer header.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const on = await isFlagOn("scheduling");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/70 bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center px-4 sm:px-6">
          <span className="inline-flex items-center gap-2.5 text-ui font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
              <AudioLines className="h-4 w-4" aria-hidden />
            </span>
            Minutely
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{on ? children : <PublicNotice title="Booking is turned off">Please contact the person who sent you this link.</PublicNotice>}</main>
      <footer className="mx-auto w-full max-w-4xl px-4 pb-10 text-meta text-muted-foreground sm:px-6">
        Scheduling by Minutely
      </footer>
    </div>
  );
}
