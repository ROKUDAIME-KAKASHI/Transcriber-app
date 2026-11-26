"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { pushOverlay } from "@/lib/overlays";
import { Button, cx, inputCls } from "./ui";

/** Small centred modal: Esc closes, Tab stays inside, Android back closes (overlay stack), 16px radius. */
export function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const unregister = pushOverlay(() => closeRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>("input, button:not(:disabled)"));
      if (f.length === 0) return;
      const a = document.activeElement;
      if (e.shiftKey && a === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && a === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative w-full max-w-sm rounded-modal border border-border/70 bg-card p-5 shadow-float"
      >
        {children}
      </div>
    </div>
  );
}

export function RenameDialog({ title, onSave, onClose }: { title: string; onSave: (t: string) => Promise<boolean>; onClose: () => void }) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (busy) return;
    if (!next || next === title) return onClose();
    setBusy(true);
    setError(false);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) onClose();
    else setError(true);
  };
  return (
    <Dialog label="Rename meeting" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 className="text-ui font-semibold">Rename meeting</h2>
        <input
          aria-label="Meeting title"
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className={cx(inputCls, "mt-3")}
        />
        {error && (
          <p role="alert" className="mt-2 text-meta text-danger-text">
            Couldn’t rename it. Try again.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({ title, onConfirm, onClose }: { title: string; onConfirm: () => Promise<boolean>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) onClose();
    else setError(true);
  };
  return (
    <Dialog label="Delete meeting" onClose={onClose}>
      <h2 className="text-ui font-semibold">Delete “{title}”?</h2>
      <p className="mt-1 text-meta text-muted-foreground">You can’t undo this.</p>
      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-text">
          Couldn’t delete it. Try again.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="danger-solid" onClick={run} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
}

/** The "⋯" button and its menu (Rename, Delete). Arrow keys move, Esc closes and returns focus. */
export function RowMenu({ title, canDelete, onRename, onDelete }: { title: string; canDelete: boolean; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (!open) return;
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  const item = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-ui hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";
  return (
    <div ref={wrap} className="absolute right-1 top-2" onKeyDown={onMenuKey}>
      <button
        ref={btn}
        type="button"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Meeting actions" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-panel border border-border bg-card shadow-float">
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden /> Rename
          </button>
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className={cx(item, "text-danger-text")}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
