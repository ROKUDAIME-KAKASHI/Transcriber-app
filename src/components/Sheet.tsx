"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";
import { pushOverlay } from "@/lib/overlays";

const WIDTH = { sm: "lg:w-[24rem]", md: "lg:w-[32rem]", lg: "lg:w-[40rem]" } as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One dialog for the calendar and the notification panel: a bottom sheet on phones, a centred card on laptops
 * (or, with placement "sidebar", a card beside the sidebar). Esc, the backdrop and the Android back key close it.
 * Tab stays inside, focus starts on Close and returns to what opened it.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  size = "sm",
  placement = "center",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof WIDTH;
  placement?: "center" | "sidebar";
}) {
  const [shown, setShown] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      setShown(true);
      closeRef.current?.focus();
    });
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const els = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      unregister();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const sidebar = placement === "sidebar";
  return (
    <>
      <div
        className={cx(
          "fixed inset-0 z-30 transition-opacity duration-[var(--dur-2)]",
          sidebar ? "bg-black/40 lg:bg-transparent" : "bg-black/40",
          shown ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal
        aria-label={title}
        className={cx(
          "safe-bottom fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] overflow-y-auto overflow-x-hidden rounded-t-modal border border-border/70 bg-card p-4 shadow-float transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-in-out)]",
          sidebar
            ? "lg:inset-x-auto lg:bottom-auto lg:left-[16rem] lg:top-3 lg:max-h-[calc(100dvh-1.5rem)] lg:w-[24rem] lg:rounded-panel"
            : cx("lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:max-h-[85dvh] lg:-translate-x-1/2 lg:rounded-modal", WIDTH[size]),
          shown ? (sidebar ? "translate-y-0 opacity-100" : "translate-y-0 opacity-100 lg:-translate-y-1/2") : sidebar ? "translate-y-full opacity-0 lg:translate-y-0" : "translate-y-full opacity-0 lg:-translate-y-[45%]"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-ui font-semibold">{title}</h2>
            {subtitle && <p className="break-words text-meta text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </>
  );
}
