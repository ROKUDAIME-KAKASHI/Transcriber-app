"use client";

import { useEffect, useRef } from "react";
import { TAB_LABELS, nextTab, type TabId } from "@/lib/meetingTabs";
import { cx } from "./ui";

export const tabId = (t: TabId) => `meeting-tab-${t}`;
export const PANEL_ID = "meeting-tabpanel";

/** Accessible tablist: arrows, Home/End, roving focus. Scrolls sideways on narrow phones. */
export function MeetingTabBar({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly TabId[];
  value: TabId;
  onChange: (t: TabId) => void;
  className?: string;
}) {
  const refs = useRef(new Map<TabId, HTMLButtonElement>());

  // Keep the selected tab in view when the row scrolls (a deep link or a restored tab).
  useEffect(() => {
    refs.current.get(value)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      role="tablist"
      aria-label="Meeting content"
      onKeyDown={(e) => {
        const next = nextTab(tabs, value, e.key);
        if (!next) return;
        e.preventDefault();
        onChange(next);
        refs.current.get(next)?.focus();
      }}
      className={cx("-mx-1 flex gap-1 overflow-x-auto border-b border-border/70 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
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
              "relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-ui font-semibold transition-colors duration-[var(--dur-2)]",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {TAB_LABELS[t]}
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
