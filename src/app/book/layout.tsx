import type { Metadata } from "next";
import { AudioLines } from "lucide-react";

export const metadata: Metadata = {
  title: "Book a time | Transcriber",
  robots: { index: false, follow: false },
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/70 bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center px-4 sm:px-6">
          <span className="inline-flex items-center gap-2.5 text-ui font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-accent text-accent-foreground">
              <AudioLines className="h-4 w-4" aria-hidden />
            </span>
            Transcriber
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{children}</main>
      <footer className="mx-auto w-full max-w-4xl px-4 pb-10 text-meta text-muted-foreground sm:px-6">
        Scheduling by Transcriber
      </footer>
    </div>
  );
}
