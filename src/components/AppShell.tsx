"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Mic, LayoutList, LogOut, AudioLines } from "lucide-react";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Record", icon: Mic },
  { href: "/meetings", label: "Meetings", icon: LayoutList },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

function Logo() {
  return (
    <Link
      href="/"
      title="Go to Record"
      className="-mx-2 inline-flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-ui font-semibold tracking-tight"
    >
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
        <AudioLines className="h-4 w-4" />
      </span>
      Transcriber
    </Link>
  );
}

/**
 * Laptops (lg+): fixed sidebar with navigation and account.
 * Phones and tablets: slim top bar plus a bottom tab bar within thumb reach.
 * All bars are opaque with a hairline (no blur, no shadow).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useSession();
  const email = data?.user?.email ?? "";

  return (
    <div className="min-h-dvh">
      {/* Sidebar (laptops) */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-card px-3 py-4 lg:flex">
        <div className="px-2.5 py-1">
          <Logo />
        </div>
        <nav className="mt-6 flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-ui font-medium transition-colors",
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border pt-3">
          <div className="flex items-center gap-2.5 px-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-meta font-semibold uppercase">
              {email.slice(0, 1) || "?"}
            </span>
            <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={email}>
              {email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar (phones, tablets) */}
      <header className="sticky top-0 z-20 border-b border-border bg-card pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] lg:hidden">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <Logo />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="-mr-2 grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
            title={email ? `Sign out (${email})` : "Sign out"}
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:px-10 lg:py-10">{children}</div>
      </main>

      {/* Bottom tab bar (phones, tablets) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-meta font-medium",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon className={cx("h-5 w-5", active && "text-accent")} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
