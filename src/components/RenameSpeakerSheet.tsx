"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pushOverlay } from "@/lib/overlays";
import { Button, FieldLabel, inputCls } from "./ui";
import { usePeople } from "@/lib/stakeholdersClient";
import { pickerOptions } from "@/lib/stakeholders";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Rename a speaker: bottom sheet on phones, popover on lg+ (render inside a `relative`
 * wrapper around the chip). Registered with the overlay stack so Android back closes it.
 */
export function RenameSpeakerSheet({
  speaker,
  currentName,
  onSave,
  onClose,
}: {
  speaker: number;
  currentName?: string;
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [shown, setShown] = useState(false);
  const { status, people } = usePeople();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setShown(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const onPointer = (e: PointerEvent) => {
      if (!window.matchMedia(DESKTOP_QUERY).matches) return;
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      // The chip button toggles itself; ignore taps on it so it doesn't instantly reopen.
      if ((t as HTMLElement).closest?.("[aria-haspopup='dialog']")) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(false);
    const ok = await onSave(value.trim());
    setSaving(false);
    if (!ok) setError(true);
  };

  // Names from the People directory that match what is typed (free text still works).
  const suggestions = useMemo(
    () => (status === "ready" ? pickerOptions(people, value, 4).filter((p) => p.name.trim().toLowerCase() !== value.trim().toLowerCase()) : []),
    [status, people, value]
  );

  const color = `var(--speaker-${speaker % 6})`;
  const inputId = `rename-speaker-${speaker}`;

  return (
    <>
      <div
        className={"fixed inset-0 z-30 bg-black/40 transition-opacity duration-[var(--dur-2)] lg:hidden " + (shown ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Rename speaker"
        aria-modal={!desktop}
        className={
          "safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-t-modal border border-border/70 bg-card p-4 shadow-float transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-in-out)] " +
          "lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-0 lg:top-full lg:z-30 lg:mt-2 lg:w-72 lg:rounded-modal " +
          (shown ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 lg:translate-y-2")
        }
      >
        <div className="mb-3 flex items-center gap-2 text-ui font-semibold">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-meta font-semibold"
            style={{ color, background: `color-mix(in oklab, ${color} 16%, var(--card))` }}
            aria-hidden
          >
            {String(speaker + 1)}
          </span>
          Rename speaker
        </div>
        <FieldLabel htmlFor={inputId}>Name</FieldLabel>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={value}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          placeholder={`Speaker ${speaker + 1}`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          className={`${inputCls} min-h-11`}
        />
        {suggestions.length > 0 && (
          <div className="mt-2" role="group" aria-label="Names from People">
            <p className="text-meta text-muted-foreground">From People</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setValue(p.name.slice(0, 40));
                    inputRef.current?.focus();
                  }}
                  className="min-h-11 max-w-full truncate rounded-chip bg-muted px-3 text-ui font-medium hover:bg-accent-soft lg:min-h-8"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-meta text-muted-foreground">Applies to the transcript, exports and minutes.</p>
        {error && (
          <p className="mt-2 text-meta text-danger-text" role="alert">
            Couldn&apos;t save the name. Try again.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" className="min-h-11 flex-1" onClick={onClose}>
            Discard changes
          </Button>
          <Button variant="primary" className="min-h-11 flex-1" loading={saving} onClick={() => void save()}>
            Save name
          </Button>
        </div>
      </div>
    </>
  );
}
