"use client";

import { memo, useEffect, useRef } from "react";
import { cx } from "./ui";

const HOT = 12;

/** Mic-level meter. Bars are transform-only; the ring buffer lives in a ref so there is no per-tick React state. */
export const Waveform = memo(function Waveform({
  level,
  bars = 56,
  height = 48,
  reduced = false,
  className,
}: {
  level: number;
  bars?: number;
  height?: number;
  reduced?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const buf = useRef<number[]>([]);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (reduced) return;
    const b = buf.current;
    b.push(clamped);
    if (b.length > bars) b.splice(0, b.length - bars);
    const floor = 4 / height;
    const offset = bars - b.length;
    for (let i = 0; i < bars; i++) {
      const el = refs.current[i];
      if (!el) continue;
      const v = i >= offset ? b[i - offset] : 0;
      el.style.transform = `scaleY(${Math.max(floor, v)})`;
    }
  }, [clamped, bars, height, reduced]);

  const aria = {
    role: "meter" as const,
    "aria-label": "Microphone level",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Math.round(clamped * 100),
  };

  if (reduced) {
    return (
      <div {...aria} className={cx("h-1 w-40 overflow-hidden rounded-full bg-muted", className)}>
        <div
          className="h-full w-full origin-left rounded-full bg-accent"
          style={{ transform: `scaleX(${clamped})`, transition: "transform 200ms ease-out" }}
        />
      </div>
    );
  }

  return (
    <div {...aria} className={cx("flex items-center gap-[2px]", className)} style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={cx("w-[3px] rounded-[2px]", i >= bars - HOT ? "bg-accent" : "bg-muted-foreground/40")}
          style={{
            height,
            transformOrigin: "center",
            transform: `scaleY(${4 / height})`,
            transition: "transform var(--dur-1) linear",
          }}
        />
      ))}
    </div>
  );
});
