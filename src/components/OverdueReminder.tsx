"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { cx } from "./ui";
import { useOverdueSummary } from "@/lib/overdueClient";
import { localToday } from "@/lib/taskTracker";
import { badgeText, overdueBadgeLabel, overdueText, shouldToastOverdue } from "@/lib/trackerPlus";

const TOAST_KEY = "transcriber.overdueToastDay";

/** The overdue count for the signed-in user, or 0 when it should not be shown. */
export function useOverdueCount(): number {
  const { user } = useAuth();
  return useOverdueSummary(user?.id ?? null)?.overdue ?? 0;
}

/** Small red count on the Tasks tab. aria-label says what the number means. */
export function OverdueBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={overdueBadgeLabel(count)}
      className={cx(
        "grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none tabular-nums text-white",
        className
      )}
    >
      {badgeText(count)}
    </span>
  );
}

/** Once a day, when the app is opened with overdue tasks: a toast with a link to the timeline. Renders nothing. */
export function OverdueReminder() {
  const count = useOverdueCount();
  const toast = useToast();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || count <= 0) return;
    handled.current = true;
    const today = localToday();
    let last: string | null = null;
    try {
      last = localStorage.getItem(TOAST_KEY);
    } catch {
      /* storage blocked: may show again next open */
    }
    if (!shouldToastOverdue({ enabled: true, overdue: count, lastShownDay: last, today })) return;
    try {
      localStorage.setItem(TOAST_KEY, today);
    } catch {
      /* ignore */
    }
    // Already looking at the tasks: the count is on screen, no need to repeat it.
    if (pathname === "/tasks") return;
    toast(overdueText(count), "danger", { label: "View", href: "/tasks?view=timeline" });
  }, [count, pathname, toast]);

  return null;
}

/** "3 tasks are overdue · View" under the Record hero. Nothing when there are none. */
export function OverdueLine() {
  const count = useOverdueCount();
  if (count <= 0) return null;
  return (
    <Link
      href="/tasks?view=timeline"
      className="flex min-h-11 items-center gap-2 border-t border-border/70 px-4 text-meta text-muted-foreground hover:bg-muted"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-danger-text" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{overdueText(count)}</span>
      <span className="font-semibold text-accent-text">View</span>
    </Link>
  );
}
