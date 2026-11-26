"use client";

import { memo, useEffect, useRef } from "react";
import { cx } from "./ui";

const BAR = 3;
const GAP = 3;
const SAMPLE_MS = 80;

/**
 * Live input level on a canvas. A requestAnimationFrame loop runs only while `state` is "live";
 * paused freezes the last frame, idle draws a flat line. Reduced motion shows a plain level meter.
 * The level is read from a ref, so there is no per-tick React state.
 */
export const LevelCanvas = memo(function LevelCanvas({
  level,
  state,
  reduced = false,
  height = 56,
  className,
}: {
  level: number;
  state: "idle" | "live" | "paused";
  reduced?: boolean;
  height?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const levelRef = useRef(clamped);
  levelRef.current = clamped;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buf = useRef<number[]>([]);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (state === "idle") buf.current = [];

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(canvas);
      const bars = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)));
      const data = buf.current.slice(-bars);
      const offset = bars - data.length;
      const mid = h / 2;
      ctx.fillStyle = (state === "live" ? css.getPropertyValue("--accent") : css.getPropertyValue("--muted-foreground")).trim() || "#888";
      ctx.globalAlpha = state === "paused" ? 0.55 : 1;
      if (state === "idle") {
        // No input: an honest flat line.
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, mid - 1, w, 2);
        return;
      }
      for (let i = 0; i < bars; i++) {
        const v = i >= offset ? data[i - offset] : 0;
        const bh = Math.max(2, v * h);
        ctx.fillRect(i * (BAR + GAP), mid - bh / 2, BAR, bh);
      }
    };

    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    ro?.observe(canvas);
    if (state !== "live") return () => ro?.disconnect();

    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < SAMPLE_MS) return;
      last = t;
      const b = buf.current;
      b.push(levelRef.current);
      if (b.length > 400) b.splice(0, b.length - 400);
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [state, reduced, height]);

  const aria = {
    role: "meter" as const,
    "aria-label": state === "live" ? "Microphone level" : state === "paused" ? "Microphone level, paused" : "Microphone level, not recording",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": state === "live" ? Math.round(clamped * 100) : 0,
  };

  if (reduced) {
    return (
      <div className={cx("flex items-center", className)} style={{ height }}>
        <div {...aria} className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full w-full origin-left rounded-full bg-accent"
            style={{ transform: `scaleX(${state === "live" ? clamped : 0})`, transition: "transform 200ms ease-out" }}
          />
        </div>
      </div>
    );
  }
  return <canvas ref={canvasRef} {...aria} className={cx("block w-full", className)} style={{ height }} />;
});
