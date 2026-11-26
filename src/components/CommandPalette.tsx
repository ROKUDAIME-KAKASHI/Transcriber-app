"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useLocalUser } from "./SyncProvider";
import { cx } from "./ui";
import { listMeetings } from "@/lib/local/repo";
import { pushOverlay } from "@/lib/overlays";
import { usePeople } from "@/lib/stakeholdersClient";
import { toggleTheme } from "@/lib/theme";
import { useTheme } from "@/lib/themePref";
import { moveActive, rankCommands, type Command } from "@/lib/commandMatch";

interface Props {
  onClose: () => void;
  tasksOn: boolean;
  scheduleOn: boolean;
  peopleOn: boolean;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Ctrl/Cmd+K: jump to a page, flip the theme, or open a meeting or person by name. Loaded only when first opened. */
export default function CommandPalette({ onClose, tasksOn, scheduleOn, peopleOn }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const { userId, available } = useLocalUser();
  const directory = usePeople(peopleOn);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [meetings, setMeetings] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const listId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Meetings come from the local (Dexie) list that is already on this device.
  useEffect(() => {
    if (!available || !userId) return;
    let live = true;
    void listMeetings(userId).then((rows) => {
      if (live) setMeetings(rows.map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt })));
    });
    return () => {
      live = false;
    };
  }, [available, userId]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const unregister = pushOverlay(() => closeRef.current());
    return () => {
      unregister();
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const { commands, actions } = useMemo(() => {
    const act = new Map<string, () => void>();
    const list: Command[] = [];
    const add = (c: Command, run: () => void) => {
      list.push(c);
      act.set(c.id, run);
    };
    const go = (href: string) => () => router.push(href);
    add({ id: "a:record", label: "Start recording", group: "Actions", keywords: "record new meeting mic" }, go("/"));
    add({ id: "a:theme", label: "Toggle theme", group: "Actions", keywords: "dark light appearance" }, () =>
      theme.setPref(toggleTheme(theme.pref, theme.systemDark))
    );
    add({ id: "g:meetings", label: "Go to Meetings", group: "Go to" }, go("/meetings"));
    if (tasksOn) add({ id: "g:tasks", label: "Go to Tasks", group: "Go to", keywords: "action items" }, go("/tasks"));
    if (scheduleOn) add({ id: "g:schedule", label: "Go to Schedule", group: "Go to", keywords: "booking link availability" }, go("/schedule"));
    if (peopleOn) add({ id: "g:people", label: "Go to People", group: "Go to", keywords: "contacts" }, go("/people"));
    add({ id: "g:profile", label: "Go to Profile", group: "Go to", keywords: "settings account" }, go("/profile"));
    for (const m of meetings) {
      add({ id: `m:${m.id}`, label: m.title || "Untitled meeting", group: "Meetings", hint: dateText(m.createdAt) }, go(`/meeting?id=${encodeURIComponent(m.id)}`));
    }
    if (peopleOn && directory.status === "ready") {
      for (const p of directory.people) {
        add({ id: `p:${p.id}`, label: p.name, group: "People", hint: p.email ?? p.designation ?? undefined }, go(`/people?q=${encodeURIComponent(p.name)}`));
      }
    }
    return { commands: list, actions: act };
  }, [router, theme, tasksOn, scheduleOn, peopleOn, meetings, directory.status, directory.people]);

  const results = useMemo(() => rankCommands(query, commands), [query, commands]);
  const current = results.length ? Math.min(active, results.length - 1) : -1;
  const optId = (i: number) => `${listId}-opt-${i}`;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    actions.get(c.id)?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(moveActive(current, e.key === "ArrowDown" ? 1 : -1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[current]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop, so focus stays trapped
    }
  };

  useEffect(() => {
    if (current >= 0) document.getElementById(optId(current))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-modal border border-border/70 bg-card shadow-float"
      >
        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? optId(current) : undefined}
            aria-label="Search commands, meetings and people"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Type a command or search"
            autoComplete="off"
            spellCheck={false}
            className="min-h-12 w-full bg-transparent text-ui outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-chip bg-muted px-1.5 py-0.5 text-meta text-muted-foreground">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && (
                  <p className="px-4 pb-1 pt-2 text-meta font-semibold text-muted-foreground" aria-hidden>
                    {c.group}
                  </p>
                )}
                <div
                  id={optId(i)}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => i !== current && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(c)}
                  className={cx(
                    "mx-1 flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-chip px-3 text-ui",
                    i === current ? "bg-accent-soft text-accent-text" : "hover:bg-muted"
                  )}
                >
                  <span className="min-w-0 truncate">{c.label}</span>
                  {c.hint && <span className="num shrink-0 truncate text-meta text-muted-foreground">{c.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {results.length === 0 && (
          <p className="px-4 py-6 text-center text-ui text-muted-foreground" role="status">
            No matches for &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
