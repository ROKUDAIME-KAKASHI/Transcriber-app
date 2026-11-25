"use client";

import { useEffect, useRef, useState } from "react";
import { pushOverlay } from "@/lib/overlays";
import type { CallPlatform } from "@/lib/guidedCall";
import { Button, cx } from "./ui";

/** A small, stylised copy of the Chrome/Edge share picker. `step` says which part to look at. */
function PickerMock({ step }: { step: 1 | 2 | 3 }) {
  const hot = "ring-2 ring-accent bg-accent-soft";
  return (
    <svg viewBox="0 0 240 150" role="img" aria-hidden className="h-auto w-full max-w-[300px] shrink-0 rounded-chip border border-border/70 bg-muted/40">
      <rect x="8" y="8" width="224" height="134" rx="8" className="fill-card" stroke="currentColor" strokeOpacity="0.15" />
      {/* Step 1: the three kinds of thing to share. */}
      {[
        { x: 16, label: "Tab" },
        { x: 84, label: "Window" },
        { x: 152, label: "Screen" },
      ].map((t, i) => (
        <g key={t.label}>
          <rect
            x={t.x} y="16" width="64" height="22" rx="5"
            className={i === 0 && step === 1 ? "fill-accent-soft stroke-accent" : i === 0 ? "fill-muted" : "fill-card"}
            strokeWidth={i === 0 && step === 1 ? 2 : 1}
            stroke={i === 0 && step === 1 ? undefined : "currentColor"}
            strokeOpacity={i === 0 && step === 1 ? 1 : 0.2}
          />
          <text x={t.x + 32} y="31" textAnchor="middle" fontSize="10.5" className="fill-foreground" fontWeight={i === 0 ? 700 : 400}>{t.label}</text>
        </g>
      ))}
      {/* Step 2: the list of tabs, the call is one of them. */}
      {[
        { y: 46, label: "Inbox", call: false },
        { y: 66, label: "Your call", call: true },
        { y: 86, label: "Docs", call: false },
      ].map((r) => (
        <g key={r.label}>
          <rect
            x="16" y={r.y} width="208" height="18" rx="4"
            className={r.call && step === 2 ? "fill-accent-soft stroke-accent" : "fill-muted"}
            strokeWidth={r.call && step === 2 ? 2 : 0}
            fillOpacity={r.call ? 1 : 0.6}
          />
          <rect x="22" y={r.y + 5} width="8" height="8" rx="2" className="fill-muted-foreground" fillOpacity="0.5" />
          <text x="36" y={r.y + 12.5} fontSize="10.5" className="fill-foreground" fontWeight={r.call ? 700 : 400}>{r.label}</text>
        </g>
      ))}
      {/* Step 3: the sound checkbox and the Share button. */}
      <rect
        x="16" y="110" width="118" height="22" rx="5"
        className={step === 3 ? "fill-accent-soft stroke-accent" : "fill-card"}
        strokeWidth={step === 3 ? 2 : 0}
      />
      <rect x="22" y="115" width="12" height="12" rx="3" className="fill-accent" />
      <path d="M25 121 l3 3 l5 -6" className="stroke-accent-foreground" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="40" y="124" fontSize="10.5" className="fill-foreground">Share tab audio</text>
      <rect x="150" y="110" width="74" height="22" rx="11" className="fill-accent" />
      <text x="187" y="124" textAnchor="middle" fontSize="10.5" className="fill-accent-foreground" fontWeight="700">Share</text>
    </svg>
  );
}

const STEPS: Array<{ n: 1 | 2 | 3; title: string; text: string }> = [
  { n: 1, title: "Choose the Tab option", text: "At the top of the window that opens, pick “Chrome Tab” (or “Tab”)." },
  { n: 2, title: "Pick your call", text: "Click the tab where your Meet, Teams or Zoom call is running." },
  { n: 3, title: "Keep the sound on, then Share", text: "Leave “Also share tab audio” switched on, then click Share." },
];

/**
 * The short guide shown before the browser's share window opens. Continue is a real click, which the
 * browser needs before it will open that window. Closing it with Escape, Cancel or Android back changes nothing.
 */
export function CallGuide({
  platform,
  opened,
  popupBlocked,
  compact,
  onContinue,
  onClose,
}: {
  platform: CallPlatform | null;
  /** The call link was just opened in another tab. */
  opened: boolean;
  /** The browser didn't open the link. */
  popupBlocked: boolean;
  /** The guide is switched off on this device: only the one-line version. */
  compact: boolean;
  onContinue: (dontShowAgain: boolean) => void;
  onClose: () => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const continueRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unregister = pushOverlay(() => closeRef.current());
    // Focus returns to what opened the guide, and Tab stays inside it while it is open.
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]");
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    continueRef.current?.focus();
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-labelledby="call-guide-title"
        className="fixed left-1/2 top-1/2 z-40 max-h-[90dvh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-border/70 bg-card p-5 shadow-float"
      >
        <h2 id="call-guide-title" className="text-ui font-semibold">
          {opened ? `${platform?.name ?? "Your call"} is open in a new tab` : "Record an online call"}
        </h2>
        {opened && (
          <p className="mt-1 text-meta text-muted-foreground">
            Join the call there, then come back to this tab and press the button below.
          </p>
        )}
        {popupBlocked && (
          <p className="mt-1 text-meta text-warning" role="status">
            Your browser blocked the new tab. Allow pop-ups for this site, or open the call yourself, then come back here.
          </p>
        )}
        {platform?.hint && <p className="mt-1 text-meta text-muted-foreground">{platform.hint}</p>}

        {compact ? (
          <p className="mt-3 text-meta text-muted-foreground">
            Next, pick the tab with your call and keep “Also share tab audio” switched on.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <PickerMock step={s.n} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-ui font-semibold">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-meta font-semibold text-accent-foreground">{s.n}</span>
                    {s.title}
                  </p>
                  <p className="mt-1 text-meta text-muted-foreground">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-4 text-meta text-muted-foreground">Use headphones so voices aren&apos;t recorded twice.</p>

        {!compact && (
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-meta text-muted-foreground">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Don&apos;t show this again on this device
          </label>
        )}

        <div className={cx("mt-4 flex gap-2", "flex-col-reverse sm:flex-row sm:justify-end")}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button ref={continueRef} variant="primary" onClick={() => onContinue(dontShow)}>
            Choose the call tab
          </Button>
        </div>
      </div>
    </>
  );
}
