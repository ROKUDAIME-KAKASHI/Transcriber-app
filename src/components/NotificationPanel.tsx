"use client";

import { useEffect, type ComponentType } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, CalendarCheck, CalendarClock, CalendarPlus, CheckCheck, Clock, ClipboardCheck, ListChecks } from "lucide-react";
import { Sheet } from "./Sheet";
import { cx } from "./ui";
import { useConnectivity } from "@/lib/connectivity";
import { badgeLabel, relativeTime, type NotifItem, type NotifKind } from "@/lib/notifications";
import type { NotifState } from "@/lib/notificationsClient";

const ICON: Record<NotifKind, { icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone: string; label: string }> = {
  soon: { icon: Clock, tone: "bg-accent-soft text-accent-text", label: "Starting soon" },
  upcoming: { icon: CalendarClock, tone: "bg-accent-soft text-accent-text", label: "Meeting" },
  booking: { icon: CalendarCheck, tone: "bg-success-soft text-success-text", label: "New booking" },
  overdue: { icon: AlertTriangle, tone: "bg-danger-soft text-danger-text", label: "Overdue" },
  dueToday: { icon: ListChecks, tone: "bg-warning-soft text-warning-text", label: "Due today" },
  followUp: { icon: CalendarPlus, tone: "bg-muted text-muted-foreground", label: "Follow-up" },
  review: { icon: ClipboardCheck, tone: "bg-muted text-muted-foreground", label: "To review" },
};

/** The bell with an unread count. Used in the laptop sidebar and the phone top bar. */
export function NotificationBell({ unread, open, onClick, className }: { unread: number; open: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className={cx("relative grid h-11 w-11 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground lg:h-9 lg:w-9", open && "text-accent-text", className)}
    >
      <Bell className="h-5 w-5 lg:h-4 lg:w-4" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="num absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white ring-2 ring-card"
        >
          {badgeLabel(unread)}
        </span>
      )}
    </button>
  );
}

/** A card beside the sidebar on laptops, a bottom sheet on phones. Refreshes when it opens. */
export function NotificationPanel({ state, onClose }: { state: NotifState; onClose: () => void }) {
  const offline = useConnectivity() === "offline";
  const { refresh, items, read, unread, markRead } = state;
  useEffect(() => {
    refresh(true);
  }, [refresh]);
  const now = Date.now();

  return (
    <Sheet title="Notifications" onClose={onClose} placement="sidebar">
      <div className="-mt-2 mb-2 flex min-h-11 items-center justify-between gap-2">
        <p className="text-meta text-muted-foreground" aria-live="polite">
          {unread > 0 ? `${unread} unread` : "All read"}
        </p>
        <button
          type="button"
          disabled={unread === 0}
          onClick={() => markRead()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-btn px-2 text-meta font-semibold text-accent-text hover:bg-accent-soft disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
        </button>
      </div>
      {offline && <p className="mb-2 text-meta text-muted-foreground">Offline. Showing what this device last saw.</p>}
      {items.length === 0 ? (
        <p className="rounded-chip bg-muted/50 px-3 py-6 text-center text-ui text-muted-foreground">You&apos;re all caught up.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-border/70">
          {items.map((it) => (
            <Row key={it.id} item={it} unread={!(it.id in read)} now={now} onOpen={() => {
              markRead([it.id]);
              onClose();
            }} />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function Row({ item, unread, now, onOpen }: { item: NotifItem; unread: boolean; now: number; onOpen: () => void }) {
  const { icon: Icon, tone, label } = ICON[item.kind];
  return (
    <li>
      <Link href={item.href} onClick={onOpen} className="flex min-h-14 items-start gap-3 rounded-chip px-2 py-2.5 hover:bg-muted">
        <span className={cx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", tone)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="sr-only">{label}: </span>
          <span className={cx("block break-words text-ui", unread ? "font-semibold" : "text-muted-foreground")}>{item.text}</span>
          {item.atMs !== null && <span className="num block text-meta text-muted-foreground">{relativeTime(item.atMs, now)}</span>}
        </span>
        {unread && (
          <>
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="sr-only">Unread</span>
          </>
        )}
      </Link>
    </li>
  );
}
