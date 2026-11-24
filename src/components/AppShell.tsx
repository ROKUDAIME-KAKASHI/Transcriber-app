"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useAuth } from "./AuthProvider";
import { ConnectivityPill } from "./ConnectivityPill";
import { useConnectivity } from "@/lib/connectivity";
import { markSignedOut } from "@/components/SyncProvider";
import { Mic, LayoutList, ListChecks, CalendarClock, LogOut, AudioLines } from "lucide-react";
import { cx } from "./ui";
import { tap } from "@/lib/haptics";
import { prefersReducedMotion } from "@/lib/motionPref";
import { useBackgroundRecording } from "@/hooks/useBackgroundRecording";
import { RecordingPill } from "./RecordingPill";
import { AppUpdateBanner } from "./AppUpdateBanner";

const NAV = [
  { href: "/", label: "Record", icon: Mic },
  { href: "/meetings", label: "Meetings", icon: LayoutList },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : href === "/meetings" ? pathname.startsWith("/meetings") || pathname === "/meeting" : pathname.startsWith(href);

function Logo() {
  return (
    <Link
      href="/"
      title="Go to Record"
      className="-mx-2 inline-flex min-h-11 items-center gap-2.5 rounded-btn px-2 text-ui font-semibold tracking-tight"
    >
      <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-accent text-accent-foreground">
        <AudioLines className="h-4 w-4" />
      </span>
      Transcriber
    </Link>
  );
}

/**
 * Laptops (lg+): fixed sidebar with navigation and account.
 * Phones and tablets: slim top bar plus a bottom tab bar within thumb reach.
 * Only the floating phone tab bar is glass; the rest is solid with hairlines.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, cachedUser } = useAuth();
  const offline = useConnectivity() === "offline";
  const email = user?.email ?? cachedUser?.email ?? "";
  const doSignOut = () => {
    if (offline) return;
    // Forget the user only after the server confirmed the sign-out; a failed request keeps sync running.
    void signOut({ redirect: false })
      .then(() => {
        markSignedOut();
        router.replace("/login");
      })
      .catch(() => {
        /* sign-out failed (flaky network): stay signed in with sync untouched */
      });
  };
  const bg = useBackgroundRecording(pathname !== "/");
  const contentRef = useRef<HTMLDivElement>(null);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const el = contentRef.current;
    if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    el.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 320, easing: "cubic-bezier(0.22,1,0.36,1)" }
    );
  }, [pathname]);
  const signOutTitle = offline ? "Sign out needs internet" : "Sign out";

  return (
    <div className="min-h-dvh">
      {/* Sidebar (laptops) */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border/70 bg-card px-3 py-4 lg:flex">
        <div className="px-2.5 py-1">
          <Logo />
          <ConnectivityPill className="mt-1" />
        </div>
        <nav className="mt-6 flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) tap();
                }}
                className={cx(
                  "flex min-h-10 items-center gap-3 rounded-btn px-2.5 text-ui font-medium transition-[background-color,transform] duration-[var(--dur-1)] active:scale-[0.96]",
                  active ? "bg-accent-soft text-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className={cx("h-4 w-4", active && "text-accent")} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border/70 pt-3">
          <div className="flex items-center gap-2.5 px-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-meta font-semibold uppercase">
              {email.slice(0, 1) || "?"}
            </span>
            <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={email}>
              {email}
            </span>
            <button
              onClick={doSignOut}
              aria-disabled={offline}
              className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground", offline && "opacity-50")}
              aria-label="Sign out"
              title={signOutTitle}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar (phones, tablets) */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] lg:hidden">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <Logo />
          <div className="ml-auto flex items-center gap-1">
          <ConnectivityPill />
          <button
            onClick={doSignOut}
              aria-disabled={offline}
            className={cx("-mr-2 grid h-11 w-11 place-items-center rounded-btn text-muted-foreground hover:text-foreground", offline && "opacity-50")}
            aria-label="Sign out"
            title={offline ? signOutTitle : email ? `Sign out (${email})` : "Sign out"}
          >
            <LogOut className="h-5 w-5" />
          </button>
          </div>
        </div>
      </header>

      <main className="lg:pl-60">
        <div ref={contentRef} className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:px-10 lg:py-10">
          <AppUpdateBanner />
          {children}
        </div>
      </main>

      {/* Bottom tab bar (phones, tablets): floating glass */}
      <nav
        className="glass fixed inset-x-4 bottom-[calc(12px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-20 mx-auto h-16 max-w-md rounded-full shadow-float lg:hidden"
        aria-label="Main"
      >
        <div className="grid h-full grid-cols-4 items-center px-1.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) tap();
                }}
                className={cx(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full text-meta font-semibold transition-transform duration-[var(--dur-1)] active:scale-[0.96]",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {active && <span className="pop-in absolute inset-0 rounded-full bg-accent-soft" aria-hidden />}
                <Icon className={cx("relative h-5 w-5", active && "text-accent")} />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {pathname !== "/" && <RecordingPill state={bg} />}
    </div>
  );
}
