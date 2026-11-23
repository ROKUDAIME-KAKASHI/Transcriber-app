"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CloudOff, X } from "lucide-react";
import { useConnectivity } from "@/lib/connectivity";
import { pushOverlay } from "@/lib/overlays";
import { useToast } from "./Toast";

const WORKS = ["Record on-device", "Read saved meetings", "Export and share saved meetings"];
const NEEDS = ["Cloud recording with speaker labels", "Creating minutes with AI"];

export function ConnectivityPill({ className = "" }: { className?: string }) {
  const conn = useConnectivity();
  const toast = useToast();
  const offline = conn === "offline";
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const wasOffline = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      setAnnounce("Offline");
    } else if (conn === "online" && wasOffline.current) {
      wasOffline.current = false;
      setAnnounce("Back online");
      toast("Back online", "success");
      setOpen(false);
    }
  }, [offline, conn, toast]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      btnRef.current?.focus();
    };
    const unregister = pushOverlay(close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} role="status" aria-live="polite" className={`relative ${className}`}>
      <span className="sr-only">{announce}</span>
      {offline && (
        <>
          <button
            ref={btnRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="-my-2 inline-flex items-center py-2"
          >
            <span className="pop-in inline-flex h-7 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-meta font-semibold text-warning">
              <CloudOff size={14} aria-hidden />
              Offline
            </span>
          </button>
          {open && (
            <div
              id={panelId}
              role="dialog"
              aria-label="Offline help"
              className="fixed inset-x-4 top-[calc(3.5rem+env(safe-area-inset-top))] z-30 rounded-panel border border-border/70 bg-card p-4 shadow-float text-left lg:absolute lg:inset-x-auto lg:left-0 lg:top-full lg:mt-2 lg:w-72"
            >
              <h2 className="text-ui font-semibold">You&apos;re offline</h2>
              <p className="mt-3 text-meta font-semibold text-muted-foreground">Works</p>
              <ul className="mt-1 space-y-1">
                {WORKS.map((t) => (
                  <li key={t} className="flex items-start gap-2 text-meta">
                    <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-meta font-semibold text-muted-foreground">Needs internet</p>
              <ul className="mt-1 space-y-1">
                {NEEDS.map((t) => (
                  <li key={t} className="flex items-start gap-2 text-meta">
                    <X size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-meta text-muted-foreground">
                Everything you record is saved on this device and syncs when you&apos;re back online.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
