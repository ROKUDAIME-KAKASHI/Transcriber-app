"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ClipboardList, Copy, FileText } from "lucide-react";
import { pushOverlay } from "@/lib/overlays";
import { Button, cx } from "./ui";

interface ShareMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  docLabel: "minutes" | "report" | null;
  fileDescription: "PDF file" | "Word file";
  hasTranscript: boolean;
  copyDescription: string;
  canCopy: boolean;
  onShareDocument: () => void;
  onShareTranscript: () => void;
  onCopy: () => void;
}

const DESKTOP_QUERY = "(min-width: 1024px)";

export function ShareMenu(props: ShareMenuProps) {
  const {
    open, onClose, anchorRef, docLabel, fileDescription, hasTranscript, copyDescription, canCopy,
    onShareDocument, onShareTranscript, onCopy,
  } = props;
  const [desktop, setDesktop] = useState(false);
  const [mounted, setMounted] = useState(false); // keeps the sheet in the DOM for the exit slide
  const [shown, setShown] = useState(false); // drives the translate transition
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Mount, then flip `shown` on the next frame so the slide-in transition runs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(t);
  }, [open]);

  // Overlay registry (Android back closes the sheet first), Escape, outside click, focus, scroll lock.
  useEffect(() => {
    if (!open) return;
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const onPointer = (e: PointerEvent) => {
      if (!desktop) return;
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    const prevOverflow = document.body.style.overflow;
    if (!desktop) document.body.style.overflow = "hidden";
    const focusId = requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
      first?.focus();
    });
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(focusId);
    };
  }, [open, desktop, anchorRef]);

  // Return focus to the trigger only when the menu closes (not when `desktop` flips while open).
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    return () => anchor?.focus();
  }, [open, anchorRef]);

  if (!mounted && !open) return null;

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next].focus();
  };

  const act = (enabled: boolean, fn: () => void) => () => {
    if (!enabled) return;
    onClose();
    fn();
  };

  const rows = (
    <div className="divide-y divide-border">
      {docLabel && (
        <Row
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          title={docLabel === "report" ? "Share report" : "Share minutes"}
          description={fileDescription}
          onClick={act(true, onShareDocument)}
        />
      )}
      <Row
        icon={<FileText className="h-4 w-4" aria-hidden />}
        title="Share transcript"
        description={hasTranscript ? fileDescription : "No transcript yet"}
        disabled={!hasTranscript}
        onClick={act(hasTranscript, onShareTranscript)}
      />
      <Row
        icon={<Copy className="h-4 w-4" aria-hidden />}
        title="Copy text"
        description={copyDescription}
        disabled={!canCopy}
        onClick={act(canCopy, onCopy)}
      />
    </div>
  );

  if (desktop) {
    if (!open) return null;
    return (
      <div
        ref={menuRef}
        role="menu"
        aria-label="Share options"
        onKeyDown={onMenuKey}
        className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-panel border border-border/70 bg-card shadow-float"
      >
        {rows}
      </div>
    );
  }

  return (
    <>
      <div
        className={cx(
          "fixed inset-0 z-30 bg-black/40 transition-opacity",
          shown && open ? "opacity-100 duration-[var(--dur-2)]" : "opacity-0 duration-150"
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        className={cx(
          "safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-t-modal border-t border-border/70 bg-card shadow-float transition-transform",
          shown && open ? "translate-y-0 duration-[var(--dur-3)] ease-[var(--ease-in-out)]" : "translate-y-full duration-150 ease-in"
        )}
      >
        <div className="pb-4">
          <div className="mx-auto mt-2 mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
          <div ref={menuRef} role="menu" aria-label="Share options" onKeyDown={onMenuKey}>
            {rows}
          </div>
          <div className="px-4">
            <Button variant="ghost" className="mt-2 min-h-11 w-full" onClick={onClose}>
              Close share menu
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Row(props: { icon: React.ReactNode; title: string; description: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={props.onClick}
      className={cx(
        "flex min-h-14 w-full items-start gap-3 px-4 py-2 text-left transition-[transform,background-color] duration-[var(--dur-1)] hover:bg-muted/60 enabled:active:scale-[0.98] active:bg-muted",
        props.disabled && "opacity-50"
      )}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-muted text-muted-foreground">{props.icon}</span>
      <span className="min-w-0">
        <span className="block text-ui font-semibold">{props.title}</span>
        <span className="mt-1 block text-meta text-muted-foreground">{props.description}</span>
      </span>
    </button>
  );
}
