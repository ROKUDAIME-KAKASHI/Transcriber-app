"use client";

import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { UserPlus } from "lucide-react";
import { cx, inputCls } from "./ui";
import { useToast } from "./Toast";
import { invalidatePeople, usePeople } from "@/lib/stakeholdersClient";
import { canAddNew, personLine, pickerOptions } from "@/lib/stakeholders";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Called with the final name when a person is picked or added (so callers can save straight away), and that
   * person's directory id when there is one (not when the add was refused or failed: the name is then plain text).
   */
  onCommit?: (name: string, personId?: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * Text field that suggests people from the directory. Free text always works: typing a name that isn't in
 * the directory keeps it as typed. When the directory is switched off, offline or not set up, this is a plain input.
 */
export function PersonPicker({ id, value, onChange, onCommit, placeholder, maxLength = 100, className, disabled, onBlur, onKeyDown }: Props) {
  const { status, people } = usePeople();
  const toast = useToast();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => (status === "ready" ? pickerOptions(people, value) : []), [status, people, value]);
  const addable = status === "ready" && canAddNew(value, people);
  const count = options.length + (addable ? 1 : 0);
  const showList = status === "ready" && open && count > 0;
  const optId = (i: number) => `${listId}-opt-${i}`;

  const pick = (name: string, personId?: string) => {
    onChange(name);
    onCommit?.(name, personId);
    setOpen(false);
    setActive(-1);
  };

  const addNew = async () => {
    const name = value.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const r = await fetch("/api/stakeholders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.status === 409) {
        // A similar person exists: don't create a second one. Keep the typed name and say why.
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        toast(j?.error ?? "This person may already be in People.", "warning");
      } else if (!r.ok) {
        toast("Couldn't add to People. The name is kept as typed.", "warning");
      } else {
        toast(`Added ${name} to People`, "success");
        invalidatePeople();
        const j = (await r.json().catch(() => null)) as { person?: { id?: string } } | null;
        pick(name, j?.person?.id);
        return;
      }
      pick(name);
    } catch {
      toast("Couldn't add to People. The name is kept as typed.", "warning");
      pick(name);
    } finally {
      setAdding(false);
    }
  };

  const choose = (i: number) => {
    if (i < options.length) pick(options[i].name, options[i].id);
    else void addNew();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showList) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % count);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a <= 0 ? count - 1 : a - 1));
        return;
      }
      if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
        return;
      }
    } else if (e.key === "ArrowDown" && status === "ready") {
      setOpen(true);
    }
    onKeyDown?.(e);
  };

  const enhanced = status === "ready";

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="words"
        role={enhanced ? "combobox" : undefined}
        aria-autocomplete={enhanced ? "list" : undefined}
        aria-expanded={enhanced ? showList : undefined}
        aria-controls={enhanced && showList ? listId : undefined}
        aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(e);
        }}
        onKeyDown={handleKey}
        className={className ?? inputCls}
      />
      {enhanced && (
        <span className="sr-only" role="status" aria-live="polite">
          {showList ? `${count} ${count === 1 ? "suggestion" : "suggestions"}` : ""}
        </span>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-chip border border-border/70 bg-card py-1 shadow-float"
        >
          {options.map((p, i) => (
            <li
              key={p.id}
              id={optId(i)}
              role="option"
              aria-selected={active === i}
              // Keep focus in the input so choosing doesn't trigger its blur-save first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              className={cx("flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5 text-ui", active === i ? "bg-accent-soft" : "hover:bg-muted")}
            >
              <span className="truncate font-medium">{p.name}</span>
              {personLine(p) && <span className="truncate text-meta text-muted-foreground">{personLine(p)}</span>}
            </li>
          ))}
          {addable && (
            <li
              id={optId(options.length)}
              role="option"
              aria-selected={active === options.length}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(options.length)}
              className={cx(
                "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-1.5 text-ui font-semibold text-accent-text",
                options.length > 0 && "border-t border-border/70",
                active === options.length ? "bg-accent-soft" : "hover:bg-muted"
              )}
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Add &lsquo;{value.trim()}&rsquo; as new person</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
