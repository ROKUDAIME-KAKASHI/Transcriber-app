"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CalendarCheck, CalendarClock, Mic } from "lucide-react";
import { cx } from "./ui";
import {
  CAL_KIND_LABEL, dayLabel, eventsOnDay, hourLabel, nowPosition, segmentsForDay, slotMinutes,
  type CalEvent, type CalKind, type CalRange,
} from "@/lib/calendarView";
import { formatInZone } from "@/lib/scheduling";

export const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Colour and a different icon per kind, so colour is never the only cue. Recorded meetings are lighter. */
export const KIND_STYLE: Record<CalKind, { chip: string; dot: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }> = {
  plan: { chip: "border-accent bg-accent-soft text-accent-text", dot: "rounded-full bg-accent", icon: CalendarClock },
  booking: { chip: "border-success bg-success-soft text-success-text", dot: "rounded-[2px] bg-success", icon: CalendarCheck },
  recorded: { chip: "border-border bg-muted/70 text-muted-foreground", dot: "rounded-full border-2 border-muted-foreground/60", icon: Mic },
};

/** Re-renders on a timer so the "now" line moves. */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
  return now;
}

export const eventLabel = (e: CalEvent, tz: string) => `${CAL_KIND_LABEL[e.kind]}: ${e.title}, ${formatInZone(new Date(e.startMs), tz)}`;

/* ---------- Week and Day: hours down the side, days across the top ---------- */

export function TimeGrid({
  range,
  events,
  tz,
  today,
  onOpenEvent,
  onPickSlot,
  onOpenDay,
  empty,
}: {
  range: CalRange;
  events: CalEvent[];
  tz: string;
  today: string;
  onOpenEvent: (e: CalEvent) => void;
  onPickSlot: (ymd: string, min: number) => void;
  onOpenDay: (ymd: string) => void;
  empty: boolean;
}) {
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = range.days;
  const nowPos = useMemo(() => nowPosition(now, tz), [now, tz]);
  const segsByDay = useMemo(() => days.map((d) => segmentsForDay(events, d, tz)), [days, events, tz]);
  const single = days.length === 1;

  // Open scrolled to the working day: an hour before now when today is shown, else 7 am.
  const first = days[0];
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.includes(nowPosition(Date.now(), tz).ymd);
    const startMin = showsToday ? Math.max(0, nowPosition(Date.now(), tz).min - 60) : 7 * 60;
    el.scrollTop = (startMin / 60) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, days.length, tz]);

  return (
    <div className="relative overflow-hidden rounded-panel border border-border/70 bg-card dark:border-border">
      <div ref={scrollRef} className="max-h-[calc(100dvh-17rem)] min-h-[22rem] overflow-y-auto overflow-x-hidden lg:max-h-[calc(100dvh-14rem)]">
        {/* Day names (stay at the top while the hours scroll) */}
        <div className="sticky top-0 z-20 flex border-b border-border/70 bg-card">
          <div className="w-11 shrink-0 sm:w-14" aria-hidden />
          <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => {
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => !single && onOpenDay(d)}
                  disabled={single}
                  aria-label={dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}
                  className={cx(
                    "flex min-h-12 min-w-0 flex-col items-center justify-center border-l border-border/70 py-1 first:border-l-0",
                    !single && "hover:bg-muted"
                  )}
                >
                  <span className={cx("text-meta font-semibold", isToday ? "text-accent-text" : "text-muted-foreground")}>
                    {dayLabel(d, { weekday: single ? "long" : "short" })}
                  </span>
                  <span
                    className={cx(
                      "num grid h-7 min-w-7 place-items-center rounded-full px-1 text-ui font-semibold",
                      isToday && "bg-accent text-accent-foreground"
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex">
          <div className="relative w-11 shrink-0 sm:w-14" style={{ height: HOUR_PX * 24 }} aria-hidden>
            {HOURS.slice(1).map((h) => (
              <span key={h} className="num absolute right-1.5 -translate-y-1/2 text-meta text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const isToday = d === nowPos.ymd;
              return (
                <div
                  key={d}
                  role="group"
                  aria-label={dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const box = e.currentTarget.getBoundingClientRect();
                    onPickSlot(d, slotMinutes(e.clientY - box.top, HOUR_PX));
                  }}
                  className="relative min-w-0 cursor-cell border-l border-border/70 first:border-l-0 [background-image:linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:100%_48px]"
                  style={{ height: HOUR_PX * 24 }}
                >
                  {segsByDay[i].map((s) => {
                    const st = KIND_STYLE[s.event.kind];
                    const Icon = st.icon;
                    const height = Math.max(((s.endMin - s.startMin) / 60) * HOUR_PX - 2, 18);
                    return (
                      <button
                        key={`${s.event.key}:${d}`}
                        type="button"
                        onClick={() => onOpenEvent(s.event)}
                        aria-label={eventLabel(s.event, tz)}
                        title={s.event.title}
                        className={cx(
                          "absolute z-10 flex min-w-0 flex-col overflow-hidden rounded-chip border-l-4 px-1 py-0.5 text-left text-meta font-semibold leading-tight shadow-card transition-[filter] hover:brightness-95 focus-visible:outline-2",
                          st.chip
                        )}
                        style={{
                          top: (s.startMin / 60) * HOUR_PX,
                          height,
                          left: `calc(${(s.col / s.cols) * 100}% + 1px)`,
                          width: `calc(${100 / s.cols}% - 3px)`,
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{s.event.title}</span>
                        </span>
                        {height >= 40 && (
                          <span className="num truncate font-normal opacity-90">{formatInZone(new Date(s.event.startMs), tz, false)}</span>
                        )}
                      </button>
                    );
                  })}
                  {isToday && (
                    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (nowPos.min / 60) * HOUR_PX }} aria-hidden>
                      <div className="relative h-0.5 bg-danger">
                        <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-danger" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {empty && (
        <p className="pointer-events-none absolute inset-x-0 top-24 z-30 mx-auto w-fit max-w-[90%] rounded-chip bg-card/95 px-3 py-2 text-center text-meta text-muted-foreground shadow-float">
          Nothing here yet. Tap an empty time to plan a meeting.
        </p>
      )}
    </div>
  );
}

/* ---------- Month ---------- */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

export function MonthGrid({
  range,
  events,
  tz,
  today,
  onOpenEvent,
  onOpenDay,
}: {
  range: CalRange;
  events: CalEvent[];
  tz: string;
  today: string;
  onOpenEvent: (e: CalEvent) => void;
  onOpenDay: (ymd: string) => void;
}) {
  const month = range.anchor.slice(0, 7);
  const byDay = useMemo(() => new Map(range.days.map((d) => [d, eventsOnDay(events, d, tz)])), [range.days, events, tz]);
  return (
    <div className="overflow-hidden rounded-panel border border-border/70 bg-card dark:border-border">
      <div className="grid grid-cols-7 border-b border-border/70" aria-hidden>
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-2 text-center text-meta font-semibold text-muted-foreground">
            <span className="sm:hidden">{w.slice(0, 1)}</span>
            <span className="hidden sm:inline">{w}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {range.days.map((d, i) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          const isToday = d === today;
          return (
            <div
              key={d}
              className={cx(
                "relative min-h-[4.25rem] min-w-0 border-border/70 p-1 sm:min-h-[6.5rem]",
                i % 7 !== 0 && "border-l",
                i >= 7 && "border-t",
                !inMonth && "bg-muted/40"
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(d)}
                aria-label={`${dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}, ${list.length === 0 ? "nothing planned" : `${list.length} ${list.length === 1 ? "event" : "events"}`}`}
                className="absolute inset-0 hover:bg-muted/60"
              />
              <span
                className={cx(
                  "num pointer-events-none relative mx-auto grid h-7 min-w-7 place-items-center rounded-full text-meta font-semibold sm:mx-0",
                  isToday ? "bg-accent text-accent-foreground" : inMonth ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {Number(d.slice(8))}
              </span>
              {/* Phones: one marker per event (shape tells the kind). Wider screens: titles. */}
              <div className="pointer-events-none relative mt-1 flex flex-wrap justify-center gap-1 sm:hidden" aria-hidden>
                {list.slice(0, 4).map((e) => (
                  <span key={e.key} className={cx("h-2 w-2", KIND_STYLE[e.kind].dot)} />
                ))}
              </div>
              <ul className="relative mt-1 hidden space-y-0.5 sm:block">
                {list.slice(0, MAX_CHIPS).map((e) => {
                  const st = KIND_STYLE[e.kind];
                  const Icon = st.icon;
                  return (
                    <li key={e.key}>
                      <button
                        type="button"
                        onClick={() => onOpenEvent(e)}
                        aria-label={eventLabel(e, tz)}
                        title={e.title}
                        className={cx("flex w-full min-w-0 items-center gap-1 rounded-chip border-l-4 px-1 text-left text-meta font-semibold hover:brightness-95", st.chip)}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{e.title}</span>
                      </button>
                    </li>
                  );
                })}
                {list.length > MAX_CHIPS && (
                  <li className="pointer-events-none px-1 text-meta text-muted-foreground">+{list.length - MAX_CHIPS} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
