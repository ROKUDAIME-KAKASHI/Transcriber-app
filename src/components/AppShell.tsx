"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Mic, LayoutList, LogOut, AudioLines } from "lucide-react";

const NAV = [
  { href: "/", label: "Record", icon: Mic },
  { href: "/meetings", label: "Meetings", icon: LayoutList },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="w-8 h-8 rounded-xl bg-accent text-accent-foreground grid place-items-center shadow-card">
        <AudioLines className="w-4.5 h-4.5" />
      </span>
      Transcriber
    </Link>
  );
}

/**
 * Laptops (lg+): fixed sidebar with navigation and account.
 * Phones and tablets: slim top bar plus a bottom tab bar within thumb reach.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useSession();
  const email = data?.user?.email ?? "";

  return (
    <div className="min-h-dvh">
      {/* Sidebar (laptops) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-border bg-card px-4 py-5">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border pt-4">
          <div className="flex items-center gap-3 px-2">
            <span className="w-8 h-8 shrink-0 rounded-full bg-muted grid place-items-center text-sm font-semibold uppercase">
              {email.slice(0, 1) || "?"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={email}>{email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar (phones, tablets) */}
      <header className="lg:hidden sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="px-4 h-14 flex items-center justify-between gap-4">
          <Logo />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg p-2 -mr-2 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
            title={email ? `Sign out (${email})` : "Sign out"}
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10 pt-5 pb-28 sm:pt-6 lg:py-10">{children}</div>
      </main>

      {/* Bottom tab bar (phones, tablets) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/90 backdrop-blur-md safe-bottom"
        aria-label="Main"
      >
        <div className="grid grid-cols-2 max-w-md mx-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                  active ? "text-accent" : "text-muted-foreground"
                }`}
              >
                <span className={`px-5 py-1 rounded-full transition-colors ${active ? "bg-accent/12" : ""}`}>
                  <Icon className="w-5 h-5" />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
