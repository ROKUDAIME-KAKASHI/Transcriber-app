"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TAB_LABELS, nextTab, type TabId } from "@/lib/meetingTabs";
import { cx } from "./ui";

export const tabId = (t: TabId) => `meeting-tab-${t}`;
export const PANEL_ID = "meeting-tabpanel";

/** Accessible tablist: arrows, Home/End, roving focus. Scrolls sideways on narrow phones. */
export function MeetingTabBar({
  tabs,
  value,
  onChange,
  labels,
  className,
}: {
  tabs: readonly TabId[];
  value: TabId;
  onChange: (t: TabId) => void;
  /** Overrides for a tab's name (the Minutes tab reads "Report" for a report). */
  labels?: Partial<Record<TabId, string>>;
  className?: string;
}) {
  const refs = useRef(new Map<TabId, HTMLButtonElement>());
  const rowRef = useRef<HTMLDivElement>(null);
  // A soft fade on the right edge tells people on a phone that more tabs are off screen.
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }, []);

  // Keep the selected tab in view when the row scrolls (a deep link or a restored tab). Scrolls only this row,
  // never the page, so opening a meeting doesn't jump down to the tabs.
  useEffect(() => {
    const row = rowRef.current;
    const el = refs.current.get(value);
    if (row && el) {
      if (el.offsetLeft < row.scrollLeft) row.scrollLeft = el.offsetLeft - 8;
      else if (el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = el.offsetLeft + el.offsetWidth - row.clientWidth + 8;
    }
    measure();
  }, [value, tabs, measure]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <div
      ref={rowRef}
      onScroll={measure}
      role="tablist"
      aria-label="Meeting content"
      onKeyDown={(e) => {
        const next = nextTab(tabs, value, e.key);
        if (!next) return;
        e.preventDefault();
        onChange(next);
        refs.current.get(next)?.focus();
      }}
      className={cx(
        "-mx-1 flex gap-1 overflow-x-auto border-b border-border/70 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        more && "[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]",
        className
      )}
    >
      {tabs.map((t) => {
        const on = t === value;
        return (
          <button
            key={t}
            ref={(el) => {
              if (el) refs.current.set(t, el);
              else refs.current.delete(t);
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={on}
            aria-controls={PANEL_ID}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t)}
            className={cx(
              "relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-ui font-semibold transition-colors duration-[var(--dur-2)] focus-visible:outline-offset-[-2px]",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {labels?.[t] ?? TAB_LABELS[t]}
            <span
              aria-hidden
              className={cx(
                "absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent transition-opacity duration-[var(--dur-2)]",
                on ? "opacity-100" : "opacity-0"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
