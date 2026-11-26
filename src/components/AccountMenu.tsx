"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleUser, LogOut, Moon, Sun, Users } from "lucide-react";
import { useTheme } from "@/lib/themePref";
import { toggleTheme } from "@/lib/theme";
import { cx } from "./ui";

/** Phones and tablets: one account button in the top bar. Profile, People (when on), theme and sign out live here. */
export function AccountMenu({
  pathname,
  email,
  peopleOn,
  offline,
  onSignOut,
}: {
  pathname: string;
  email: string;
  peopleOn: boolean;
  offline: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { pref, systemDark, setPref } = useTheme();
  const nextTheme = toggleTheme(pref, systemDark);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = "flex min-h-11 w-full items-center gap-3 rounded-chip px-3 text-left text-ui hover:bg-muted";
  const accountActive = pathname.startsWith("/profile") || pathname.startsWith("/people");
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email ? `Account (${email})` : "Account"}
        className={cx(
          "-mr-2 grid h-11 w-11 place-items-center rounded-btn hover:text-foreground",
          accountActive || open ? "text-accent-text" : "text-muted-foreground"
        )}
      >
        <CircleUser className="h-6 w-6" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="pop-in absolute right-0 top-full z-30 mt-1 w-64 rounded-panel border border-border bg-card p-1.5 shadow-float"
        >
          {email && (
            <p className="truncate px-3 py-2 text-meta text-muted-foreground" title={email}>
              {email}
            </p>
          )}
          <Link role="menuitem" href="/profile" aria-current={pathname === "/profile" ? "page" : undefined} className={item}>
            <CircleUser className="h-4 w-4" aria-hidden />
            Profile
          </Link>
          {peopleOn && (
            <Link role="menuitem" href="/people" aria-current={pathname.startsWith("/people") ? "page" : undefined} className={item}>
              <Users className="h-4 w-4" aria-hidden />
              People
            </Link>
          )}
          <button type="button" role="menuitem" onClick={() => setPref(nextTheme)} className={item}>
            {nextTheme === "dark" ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
            {nextTheme === "dark" ? "Dark theme" : "Light theme"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            aria-disabled={offline}
            title={offline ? "Sign out needs internet" : "Sign out"}
            className={cx(item, offline && "opacity-50")}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
