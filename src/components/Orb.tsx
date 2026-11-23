"use client";

import { memo, useEffect, useRef } from "react";
import type { CalmResult } from "@/lib/calmMode";
import { cx } from "./ui";

const FRAME_MS = 33;

/** Mic-reactive aurora glow. One rAF loop, only while live; writes transform/opacity through a ref (no React state). */
export const Orb = memo(function Orb({
  level,
  mode,
  size = 280,
  className,
}: {
  level: number;
  mode: CalmResult;
  size?: number;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  target.current = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (mode !== "live") {
      node.style.transform = "none";
      node.style.opacity = "0.25";
      return;
    }
    let raf = 0;
    let last = 0;
    let smooth = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME_MS) return;
      last = t;
      smooth += (target.current - smooth) * 0.15;
      node.style.transform = `scale(${1 + smooth * 0.35})`;
      node.style.opacity = String(0.35 + smooth * 0.5);
    };
    const start = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [mode]);

  return (
    <div
      aria-hidden
      className={cx("pointer-events-none grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <div
        ref={el}
        className={cx("h-full w-full rounded-full", mode === "idle" && "orb-breathe")}
        style={{
          background:
            "radial-gradient(circle at 30% 40%, var(--glow-a), transparent 60%), radial-gradient(circle at 70% 60%, var(--glow-b), transparent 60%)",
          filter: "blur(40px)",
          willChange: "transform, opacity",
          opacity: 0.25,
        }}
      />
    </div>
  );
});
