"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { ConnectivityPill } from "./ConnectivityPill";
import { useConnectivity } from "@/lib/connectivity";
import { useSignOut } from "@/hooks/useSignOut";
import { Mic, LayoutList, ListChecks, CalendarClock, Users, LogOut, AudioLines, Search } from "lucide-react";
import { cx } from "./ui";
import { tap } from "@/lib/haptics";
import { prefersReducedMotion } from "@/lib/motionPref";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { applyTheme, getThemePref } from "@/lib/themePref";
import { RecordingPill } from "./RecordingPill";
import { AppUpdateBanner } from "./AppUpdateBanner";
import { useFlag } from "@/lib/flagsClient";
import { OverdueBadge, OverdueReminder, useOverdueCount } from "./OverdueReminder";
import { isNative } from "@/lib/native";
import { refreshDisplayName, useCustomName } from "@/lib/displayName";

// Loaded the first time it is opened, so it adds nothing to the first page load.
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });

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
      <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
        <AudioLines className="h-4 w-4" />
      </span>
      Minutely
    </Link>
  );
}

/**
 * Laptops (lg+): fixed sidebar with navigation and account.
 * Phones and tablets: slim top bar plus a bottom tab bar within thumb reach.
 * Everything is solid with hairline borders. Phones put People, Profile, theme and sign out in an account menu.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tasksOn = useFlag("taskTracker");
  const scheduleOn = useFlag("scheduling");
  const navItems = NAV.filter((n) => (n.href === "/tasks" ? tasksOn : n.href === "/schedule" ? scheduleOn : true));
  const peopleOn = useFlag("stakeholders");
  const overdue = useOverdueCount();
  const { user, cachedUser } = useAuth();
  const offline = useConnectivity() === "offline";
  const email = user?.email ?? cachedUser?.email ?? "";
  const customName = useCustomName();
  useEffect(() => {
    if (email) refreshDisplayName().catch(() => {});
  }, [email]);
  const signOutNow = useSignOut();
  const doSignOut = () => {
    if (offline) return;
    signOutNow();
  };
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
  // Keep the browser theme-color in step with the saved theme (the head script runs before the tags may exist).
  useEffect(() => applyTheme(getThemePref()), []);
  const signOutTitle = offline ? "Sign out needs internet" : "Sign out";

  // Ctrl/Cmd+K, laptops only: not on phones (narrow or touch) and not in the Android app.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mac, setMac] = useState(false);
  const [paletteOk, setPaletteOk] = useState(false);
  useEffect(() => {
    setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    setPaletteOk(!isNative());
  }, []);
  useEffect(() => {
    const laptop = () => !isNative() && window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k" && laptop()) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh">
      {/* Sidebar (laptops) */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-card px-3 py-4 lg:flex">
        <div className="px-2.5 py-1">
          <Logo />
          <ConnectivityPill className="mt-1" />
        </div>
        {paletteOk && (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            aria-keyshortcuts="Control+K Meta+K"
            className="mt-4 flex min-h-9 items-center gap-2 rounded-btn border border-border/70 px-2.5 text-meta text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span className="flex-1 text-left">Search or jump to</span>
            <kbd className="rounded-chip bg-muted px-1.5 py-0.5 font-sans">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        )}
        <nav className="mt-4 flex flex-col gap-0.5" aria-label="Main">
          {navItems.map(({ href, label, icon: Icon }) => {
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
                  active ? "bg-accent-soft text-accent-text" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {href === "/tasks" && <OverdueBadge count={overdue} className="ml-auto" />}
              </Link>
            );
          })}
          {peopleOn && (
            <Link
              href="/people"
              aria-current={pathname.startsWith("/people") ? "page" : undefined}
              className={cx(
                "flex min-h-10 items-center gap-3 rounded-btn px-2.5 text-ui font-medium transition-[background-color,transform] duration-[var(--dur-1)] active:scale-[0.96]",
                pathname.startsWith("/people") ? "bg-accent-soft text-accent-text" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Users className="h-4 w-4" />
              People
            </Link>
          )}
        </nav>
        <div className="mt-auto border-t border-border pt-3">
          <div className="flex items-center gap-1 px-1.5">
            <Link
              href="/profile"
              aria-label="Profile"
              aria-current={pathname === "/profile" ? "page" : undefined}
              title="Profile"
              className={cx(
                "flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-btn px-1 hover:bg-muted",
                pathname === "/profile" && "bg-accent-soft"
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-meta font-semibold uppercase">
                {email.slice(0, 1) || "?"}
              </span>
              <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={email}>
                {customName ?? email}
              </span>
            </Link>
            <ThemeToggle />
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
      <header className="sticky top-0 z-20 border-b border-border bg-background pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] lg:hidden">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <Logo />
          <div className="ml-auto flex items-center gap-1">
          <ConnectivityPill />
          <AccountMenu pathname={pathname} email={email} peopleOn={peopleOn} offline={offline} onSignOut={doSignOut} />
          </div>
        </div>
      </header>

      <main className="lg:pl-60">
        <div ref={contentRef} className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:px-10 lg:py-10">
          <AppUpdateBanner />
          {children}
        </div>
      </main>

      {/* Bottom tab bar (phones, tablets): opaque, hairline top border, safe-area aware */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
          {navItems.map(({ href, label, icon: Icon }) => {
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
                  "relative flex min-h-14 min-w-11 flex-col items-center justify-center gap-0.5 text-meta font-semibold transition-colors active:bg-muted",
                  active ? "text-accent-text" : "text-muted-foreground"
                )}
              >
                {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-accent" aria-hidden />}
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {href === "/tasks" && <OverdueBadge count={overdue} className="absolute -right-2.5 -top-1.5 ring-2 ring-card" />}
                </span>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} tasksOn={tasksOn} scheduleOn={scheduleOn} peopleOn={peopleOn} />}
      <OverdueReminder />
      <RecordingPill />
    </div>
  );
}
