"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "@/components/AuthProvider";
import { useLocalUser } from "@/components/SyncProvider";
import { useConnectivity } from "./connectivity";
import { useFlag } from "./flagsClient";
import { hasPlugin, getApp } from "./native";
import { isRecordingActive } from "./recordingFlag";
import { listMeetings } from "./local/repo";
import { readExtras } from "./meetingExtras";
import { invalidateOverdue, useOverdueSummary } from "./overdueClient";
import { localToday } from "./taskTracker";
import { browserZone, loadBookings, loadPlans, readCalCache, type CalCache } from "./calendarCache";
import {
  REVIEW_DAYS, buildNotifications, markRead, parseRead, readKey, unreadCount, type NotifItem, type ReadMap, type ReviewRow,
} from "./notifications";

const TICK_MS = 60_000;
const REFRESH_MS = 5 * 60_000;
const MIN_GAP_MS = 20_000;
const DAY = 86_400_000;

export interface NotifState {
  enabled: boolean;
  items: NotifItem[];
  unread: number;
  read: ReadMap;
  /** Fetch again (the panel calls this when it opens). Cheap: two existing endpoints, at most once per 20 s unless forced. */
  refresh: (force?: boolean) => void;
  /** Marks the given items read (all current ones when none are given). */
  markRead: (ids?: string[]) => void;
}

/**
 * Notification items for the bell. Everything comes from existing endpoints (plans, bookings, the task summary)
 * and this device (recorded meetings with action items waiting). Refreshes on mount, when the app comes back,
 * every 5 minutes while visible, and when the panel opens. Read state is kept in localStorage per user.
 */
export function useNotifications(): NotifState {
  const on = useFlag("notifications");
  const plansOn = useFlag("plannedMeetings");
  const schedOn = useFlag("scheduling");
  const online = useConnectivity() !== "offline";
  const { user, cachedUser } = useAuth();
  const local = useLocalUser();
  const userId = local.userId ?? user?.id ?? cachedUser?.id ?? null;
  const enabled = on && !!userId;

  const [data, setData] = useState<CalCache>({ tz: null, plans: [], bookings: [] });
  const [read, setRead] = useState<ReadMap>({});
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const last = useRef(0);
  const inflight = useRef(false);

  // This account's saved copy and read state.
  useEffect(() => {
    if (!enabled || !userId) return;
    setData(readCalCache(userId));
    try {
      setRead(parseRead(localStorage.getItem(readKey(userId))));
    } catch {
      setRead({});
    }
  }, [enabled, userId]);

  const refresh = useCallback(
    (force = false) => {
      if (!enabled || !online || inflight.current) return;
      if (!force && Date.now() - last.current < MIN_GAP_MS) return;
      inflight.current = true;
      last.current = Date.now();
      void (async () => {
        try {
          // Never touch the network while a recording is running; the next refresh catches up.
          if (await isRecordingActive().catch(() => true)) return;
          const t = Date.now();
          const [p, b] = await Promise.all([
            plansOn ? loadPlans(userId, t - 8 * DAY, t + 30 * DAY) : Promise.resolve(null),
            schedOn ? loadBookings(userId) : Promise.resolve(null),
          ]);
          const fresh = b ?? p;
          if (fresh) setData({ tz: fresh.tz, plans: p?.plans ?? fresh.plans, bookings: b?.bookings ?? fresh.bookings });
          if (force) invalidateOverdue();
          setNow(Date.now());
          setTick((n) => n + 1);
        } finally {
          inflight.current = false;
        }
      })();
    },
    [enabled, online, plansOn, schedOn, userId]
  );

  // Start-up, coming back to the app, and every 5 minutes while visible.
  useEffect(() => {
    if (!enabled) return;
    refresh(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        refresh(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (Date.now() - last.current >= REFRESH_MS) refresh(false);
    }, TICK_MS);
    let remove: (() => void) | null = null;
    let gone = false;
    if (hasPlugin("App")) {
      getApp()
        .then((app) => app.addListener("appStateChange", (s: { isActive: boolean }) => s.isActive && refresh(false)))
        .then((h) => {
          if (gone) void h.remove();
          else remove = () => void h.remove();
        })
        .catch(() => {});
    }
    return () => {
      gone = true;
      remove?.();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  const summary = useOverdueSummary(enabled ? userId : null);
  const meetings = useLiveQuery(async () => (enabled && userId ? await listMeetings(userId) : []), [enabled, userId]);

  const reviews = useMemo<ReviewRow[]>(() => {
    if (!userId) return [];
    const out: ReviewRow[] = [];
    for (const m of meetings ?? []) {
      if (m.deleted === 1 || m.status !== "DONE") continue;
      const at = new Date(m.createdAt).getTime() + m.durationSec * 1000;
      if (now - at > REVIEW_DAYS * DAY) continue;
      const n = readExtras(userId, m.id).items?.length ?? 0;
      if (n > 0) out.push({ meetingId: m.id, title: m.title || "Untitled meeting", count: n, atMs: at });
    }
    return out.sort((a, b) => b.atMs - a.atMs);
    // tick: re-read the device's saved action items after each refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, userId, now, tick]);

  const tz = data.tz ?? browserZone();
  const items = useMemo(
    () =>
      enabled
        ? buildNotifications({
            nowMs: now,
            tz,
            plans: data.plans,
            bookings: data.bookings,
            tasks: summary ? { overdue: summary.overdue, dueToday: summary.dueToday } : null,
            today: localToday(new Date(now)),
            reviews,
          })
        : [],
    [enabled, now, tz, data, summary, reviews]
  );

  const markIds = useCallback((ids?: string[]) => {
    if (!userId) return;
    setRead((r) => {
      const next = markRead(r, ids ?? items.map((i) => i.id), Date.now());
      try {
        localStorage.setItem(readKey(userId), JSON.stringify(next));
      } catch {
        /* storage blocked: the badge clears until the next reload */
      }
      return next;
    });
  }, [items, userId]);

  return { enabled, items, unread: unreadCount(items, read), read, refresh, markRead: markIds };
}
