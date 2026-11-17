"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Mic, ListMusic, LogOut } from "lucide-react";

const NAV = [
  { href: "/", label: "Record", icon: Mic },
  { href: "/meetings", label: "Meetings", icon: ListMusic },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useSession();

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-accent text-accent-foreground grid place-items-center">
              <Mic className="w-4 h-4" />
            </span>
            Transcriber
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  pathname === href ? "bg-muted" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 min-w-0"
            title="Sign out"
          >
            <span className="truncate max-w-[10rem] hidden sm:inline">{data?.user?.email}</span>
            <LogOut className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6 pb-28 sm:pb-6">{children}</main>

      {/* Bottom tab bar on phones */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-10 border-t border-border bg-background/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                  active ? "text-accent" : "text-muted-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
