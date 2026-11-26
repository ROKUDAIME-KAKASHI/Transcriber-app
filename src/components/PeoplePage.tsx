"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CloudOff, Plus, Search, UserPlus, Users } from "lucide-react";
import { Badge, Button, FieldLabel, Notice, Panel, cx, inputCls } from "./ui";
import { useToast } from "./Toast";
import { useConnectivity } from "@/lib/connectivity";
import { pushOverlay } from "@/lib/overlays";
import { invalidatePeople } from "@/lib/stakeholdersClient";
import {
  findPossibleDuplicate, groupAlphabetically, initials, matchesQuery, personLine, type Person, type Suggestion,
} from "@/lib/stakeholders";

type Draft = { name: string; designation: string; organisation: string; area: string; email: string; phone: string; notes: string };

const EMPTY: Draft = { name: "", designation: "", organisation: "", area: "", email: "", phone: "", notes: "" };

const toDraft = (p: Person): Draft => ({
  name: p.name, designation: p.designation ?? "", organisation: p.organisation ?? "", area: p.area ?? "",
  email: p.email ?? "", phone: p.phone ?? "", notes: p.notes ?? "",
});

async function errorOf(r: Response, fallback: string): Promise<{ message: string; code?: string }> {
  const j = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
  return { message: j?.error ?? fallback, code: j?.code };
}

/* ---------- Add / edit sheet ---------- */
function PersonSheet({
  person,
  all,
  prefill,
  onClose,
  onSaved,
}: {
  person: Person | null;
  all: Person[];
  prefill?: Partial<Draft>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (person ? toDraft(person) : { ...EMPTY, ...prefill }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [forceName, setForceName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shown, setShown] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      setShown(true);
      nameRef.current?.focus();
    });
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const f = Array.from(boxRef.current.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)"));
      if (f.length === 0) return;
      const a = document.activeElement;
      if (e.shiftKey && (a === f[0] || !boxRef.current.contains(a))) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (a === f[f.length - 1] || !boxRef.current.contains(a))) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      unregister();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const set = (k: keyof Draft, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (k === "name" || k === "email") setForceName(false);
    if (k === "name") setNameErr("");
    if (k === "email") setEmailErr("");
    setError("");
  };

  const dup = useMemo(
    () => findPossibleDuplicate({ name: draft.name, email: draft.email }, all, person?.id),
    [draft.name, draft.email, all, person]
  );

  const save = async () => {
    if (saving) return;
    if (!draft.name.trim()) {
      setNameErr("Name is required.");
      nameRef.current?.focus();
      return;
    }
    if (dup?.reason === "email") {
      setEmailErr(`${dup.person.name} already uses this email.`);
      return;
    }
    setSaving(true);
    setError("");
    setNameErr("");
    setEmailErr("");
    try {
      const r = await fetch(person ? `/api/stakeholders/${person.id}` : "/api/stakeholders", {
        method: person ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, force: forceName || undefined }),
      });
      if (r.ok) {
        onSaved(person ? "Saved" : `Added ${draft.name.trim()}`);
        return;
      }
      const e = await errorOf(r, "Couldn't save this person. Try again.");
      if (e.code === "similar_name") setForceName(true);
      if (/email/i.test(e.message)) setEmailErr(e.message);
      else setError(e.message);
    } catch {
      setError("Couldn't reach the server. Your changes are still here. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!person || saving) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/stakeholders/${person.id}`, { method: "DELETE" });
      if (r.ok) {
        onSaved(`Removed ${person.name}`);
        return;
      }
      setError((await errorOf(r, "Couldn't delete this person. Try again.")).message);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Inline messages sit under their own field. A saved-email clash is an error; a similar name is only a warning.
  const emailMsg = emailErr || (dup?.reason === "email" ? `${dup.person.name} already uses this email.` : "");
  const nameWarn = !nameErr && dup?.reason === "name" ? `Possible duplicate of ${dup.person.name}.` : "";
  const field = (k: keyof Draft, label: string, props: Record<string, unknown> = {}) => {
    const err = k === "name" ? nameErr : k === "email" ? emailMsg : "";
    const hint = k === "name" ? nameWarn : "";
    const msgId = `person-${k}-msg`;
    return (
      <div>
        <FieldLabel htmlFor={`person-${k}`}>{label}</FieldLabel>
        <input
          id={`person-${k}`}
          ref={k === "name" ? nameRef : undefined}
          value={draft[k]}
          onChange={(e) => set(k, e.target.value)}
          className={cx(inputCls, "min-h-11", err && "ring-2 ring-danger")}
          autoComplete="off"
          aria-invalid={err ? true : undefined}
          aria-describedby={err || hint ? msgId : undefined}
          {...props}
        />
        {(err || hint) && (
          <p id={msgId} role={err ? "alert" : "status"} className={cx("mt-1 text-meta", err ? "text-danger-text" : "text-warning-text")}>
            {err || hint}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={cx("fixed inset-0 z-30 bg-black/40 transition-opacity duration-[var(--dur-2)]", shown ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={person ? "Edit person" : "Add person"}
        className={cx(
          "safe-bottom fixed inset-x-0 bottom-0 z-40 max-h-[90dvh] overflow-y-auto rounded-t-modal border border-border/70 bg-card p-4 shadow-float",
          "transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-in-out)]",
          "lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-[28rem] lg:-translate-x-1/2 lg:rounded-modal",
          shown ? "translate-y-0 opacity-100 lg:-translate-y-1/2" : "translate-y-full opacity-0 lg:-translate-y-[45%]"
        )}
      >
        <h2 className="mb-3 text-ui font-semibold">{person ? "Edit person" : "Add person"}</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {field("name", "Name", { maxLength: 100, autoCapitalize: "words" })}
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {field("designation", "Designation", { maxLength: 100 })}
            {field("organisation", "Organisation", { maxLength: 100 })}
          </div>
          {field("area", "Area of involvement", { maxLength: 100, placeholder: "For example Finance or Site safety" })}
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {field("email", "Email", { type: "email", inputMode: "email", maxLength: 200, autoCapitalize: "none" })}
            {field("phone", "Phone", { type: "tel", inputMode: "tel", maxLength: 40 })}
          </div>
          <div>
            <FieldLabel htmlFor="person-notes">Notes</FieldLabel>
            <textarea
              id="person-notes"
              rows={2}
              maxLength={2000}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={cx(inputCls, "min-h-11 resize-y py-2")}
            />
          </div>

          {error && (
            <p className="text-meta text-danger-text" role="alert">
              {error}
              {forceName && " Choose Save anyway to keep both."}
            </p>
          )}

          {confirmDelete ? (
            <div className="rounded-chip bg-muted p-3">
              <p className="text-ui font-semibold">Delete {person?.name}?</p>
              <p className="mt-0.5 text-meta text-muted-foreground">Meetings and tasks that mention this name are not changed.</p>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="danger-solid" loading={saving} onClick={() => void remove()}>
                  Delete
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="ghost" className="min-h-11 flex-1" onClick={onClose}>
                Discard changes
              </Button>
              <Button type="submit" variant="primary" className="min-h-11 flex-1" loading={saving}>
                {forceName ? "Save anyway" : person ? "Save changes" : "Add person"}
              </Button>
              {person && (
                <Button type="button" variant="danger" className="min-h-11 w-full" onClick={() => setConfirmDelete(true)}>
                  Delete person
                </Button>
              )}
            </div>
          )}
        </form>
      </div>
    </>
  );
}

/* ---------- Page ---------- */
export function PeoplePage() {
  const toast = useToast();
  const offline = useConnectivity() === "offline";
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  // A link from the command palette arrives as /people?q=name.
  const [q, setQ] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("q") ?? "")));
  const [sheet, setSheet] = useState<{ person: Person | null; prefill?: Partial<Draft> } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const peopleRef = useRef<Person[] | null>(null);
  useEffect(() => {
    peopleRef.current = people;
  });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stakeholders", { cache: "no-store" });
      if (!r.ok) throw new Error((await errorOf(r, "Couldn't load your people. Try again.")).message);
      const j = (await r.json()) as { people: Person[] };
      setPeople(j.people);
      setError("");
      // Suggestions are optional: a failure just hides them.
      fetch("/api/stakeholders/suggestions", { cache: "no-store" })
        .then((s) => (s.ok ? (s.json() as Promise<{ suggestions: Suggestion[] }>) : null))
        .then((s) => setSuggestions(s?.suggestions ?? []))
        .catch(() => setSuggestions([]));
    } catch (e) {
      // Keep whatever was loaded before; nothing is lost on a failed refresh.
      setError(e instanceof Error && e.message ? e.message : "Couldn't load your people. Try again.");
      if (!peopleRef.current) setPeople(null);
    }
  }, []);

  useEffect(() => {
    if (!offline) void load();
  }, [load, offline]);

  const shown = useMemo(() => (people ?? []).filter((p) => matchesQuery(p, q)), [people, q]);
  const groups = useMemo(() => groupAlphabetically(shown), [shown]);

  const addSuggestion = async (s: Suggestion) => {
    if (adding) return;
    setAdding(s.name);
    try {
      const r = await fetch("/api/stakeholders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, email: s.email ?? undefined }),
      });
      if (r.ok) {
        toast(`Added ${s.name}`, "success");
      } else {
        const e = await errorOf(r, "Couldn't add this person.");
        toast(e.message, "warning");
      }
      invalidatePeople();
      await load();
    } catch {
      toast("Couldn't add this person. Try again.", "danger");
    } finally {
      setAdding(null);
    }
  };

  const saved = (msg: string) => {
    setSheet(null);
    toast(msg, "success");
    invalidatePeople();
    void load();
  };

  const loading = people === null && !error && !offline;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-ui text-muted-foreground">The people you meet. Pick them as attendees and task owners.</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} disabled={offline} onClick={() => setSheet({ person: null })}>
          Add person
        </Button>
      </div>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="People need internet for now">
          {people?.length ? "You are seeing the last list loaded. Changes are paused until you are back online." : "Connect to see and edit your people."}
        </Notice>
      )}
      {error && !offline && (
        <Notice tone="danger" title={error}>
          <button type="button" onClick={() => void load()} className="mt-1 min-h-11 rounded-btn font-semibold text-accent-text underline-offset-2 hover:underline">
            Try again
          </button>
        </Notice>
      )}

      {!offline && suggestions.length > 0 && (
        <section aria-label="Add from your meetings">
          <h2 className="text-meta font-semibold text-muted-foreground">Add from your meetings</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={`${s.name}|${s.email ?? ""}`}
                type="button"
                disabled={adding !== null}
                onClick={() => void addSuggestion(s)}
                title={s.email ?? undefined}
                className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-chip border border-border/70 bg-card px-3 text-ui font-medium shadow-card hover:bg-muted disabled:opacity-50 lg:min-h-9"
              >
                <UserPlus className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-ui text-muted-foreground">Loading…</p>
      ) : people && people.length === 0 ? (
        !offline && (
          <Panel className="p-6 text-center">
            <Users className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-ui text-muted-foreground">No people yet. Add the people you meet so you can pick them as attendees and task owners.</p>
          </Panel>
        )
      ) : people ? (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="people-search" className="sr-only">
              Search people
            </label>
            <input
              id="people-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email, designation or organisation"
              autoComplete="off"
              className={cx(inputCls, "pl-11")}
            />
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {shown.length} {shown.length === 1 ? "person" : "people"}
          </p>
          {shown.length === 0 ? (
            <p className="text-ui text-muted-foreground">No one matches &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            <div className={cx("space-y-4", offline && "pointer-events-none opacity-60")}>
              {groups.map((g) => (
                <section key={g.letter} aria-label={`People ${g.letter}`}>
                  <h2 className="px-1 pb-1 text-meta font-semibold text-muted-foreground" aria-hidden>
                    {g.letter}
                  </h2>
                  <Panel as="div">
                    <ul className="divide-y divide-border/70">
                      {g.people.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setSheet({ person: p })}
                            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-meta font-semibold text-accent-text" aria-hidden>
                              {initials(p.name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-ui font-semibold">{p.name}</span>
                              {(personLine(p) || p.email) && (
                                <span className="block truncate text-meta text-muted-foreground">{[personLine(p), p.email].filter(Boolean).join(" · ")}</span>
                              )}
                            </span>
                            {p.area && (
                              <span className="hidden max-w-[40%] shrink-0 min-[420px]:block">
                                <Badge tone="accent">
                                  <span className="truncate">{p.area}</span>
                                </Badge>
                              </span>
                            )}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}

      {sheet && (
        <PersonSheet
          key={sheet.person?.id ?? "new"}
          person={sheet.person}
          all={people ?? []}
          prefill={sheet.prefill}
          onClose={() => setSheet(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
