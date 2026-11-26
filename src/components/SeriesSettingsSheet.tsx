"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Notice, cx } from "./ui";
import { pushOverlay } from "@/lib/overlays";
import { KEEP_AHEAD_CHOICES } from "@/lib/calendar";
import { CADENCES, CADENCE_LABEL, type Cadence, type SeriesDTO } from "@/lib/planning";

const chipCls = (on: boolean) =>
  cx(
    "inline-flex min-h-12 min-w-12 items-center justify-center rounded-chip border px-3 text-ui font-semibold transition-colors disabled:opacity-50 lg:min-h-10",
    on ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
  );

async function errorOf(r: Response, fallback: string): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? fallback;
}

/**
 * Series settings: how often it repeats and how many meetings to keep planned ahead. A bottom sheet on phones, a
 * dialog on laptops. Each choice saves straight away. The keep-ahead part hides itself when the calendar feature
 * isn't available yet, so the cadence can still be edited.
 */
export function SeriesSettingsSheet({
  series,
  calendarOn,
  offline,
  onChanged,
  onClose,
}: {
  series: SeriesDTO;
  calendarOn: boolean;
  offline: boolean;
  onChanged: (s: SeriesDTO) => void;
  onClose: () => void;
}) {
  const [cadence, setCadence] = useState<Cadence>(series.cadence);
  const [keepAhead, setKeepAhead] = useState<number | null>(null);
  const [keepAvailable, setKeepAvailable] = useState(calendarOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setShown(true);
      closeRef.current?.focus();
    });
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      unregister();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!calendarOn || offline) return;
    let cancelled = false;
    void fetch(`/api/series/${encodeURIComponent(series.id)}/keep-ahead`, { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setKeepAvailable(false);
          return;
        }
        const j = (await r.json()) as { keepAhead?: number };
        setKeepAhead(typeof j.keepAhead === "number" ? j.keepAhead : 0);
      })
      .catch(() => {
        if (!cancelled) setKeepAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarOn, offline, series.id]);

  const saveCadence = async (c: Cadence) => {
    if (busy || c === cadence) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/series/${encodeURIComponent(series.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: c }),
      });
      if (!r.ok) {
        setError(await errorOf(r, "Couldn't save how often it repeats."));
        return;
      }
      const j = (await r.json()) as { series?: SeriesDTO };
      setCadence(c);
      if (j.series) onChanged(j.series);
      setMsg("Saved");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveKeepAhead = async (n: number) => {
    if (busy || n === keepAhead) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/series/${encodeURIComponent(series.id)}/keep-ahead`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAhead: n }),
      });
      if (!r.ok) {
        setError(await errorOf(r, "Couldn't save this setting."));
        return;
      }
      const j = (await r.json()) as { created?: number };
      setKeepAhead(n);
      setMsg(n === 0 ? "Saved. No more meetings will be added." : j.created ? `Saved. ${j.created} meeting${j.created === 1 ? "" : "s"} planned.` : "Saved");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={cx("fixed inset-0 z-30 bg-black/40 transition-opacity duration-[var(--dur-2)]", shown ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal
        aria-label={`Series settings: ${series.title}`}
        className={cx(
          "safe-bottom fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-modal border border-border/70 bg-card p-4 shadow-float transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-in-out)]",
          "lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-[28rem] lg:-translate-x-1/2 lg:rounded-modal",
          shown ? "translate-y-0 opacity-100 lg:-translate-y-1/2" : "translate-y-full opacity-0 lg:-translate-y-[45%]"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-ui font-semibold">Series settings</h2>
            <p className="truncate text-meta text-muted-foreground">{series.title}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close series settings"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-3 space-y-4">
          <div>
            <p className="mb-1.5 text-meta font-semibold">Repeats</p>
            <div role="group" aria-label="How often it repeats" className="flex flex-wrap gap-2">
              {CADENCES.map((c) => (
                <button key={c} type="button" disabled={busy || offline} aria-pressed={cadence === c} onClick={() => void saveCadence(c)} className={chipCls(cadence === c)}>
                  {CADENCE_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {keepAvailable && (
            <div>
              <p className="mb-1.5 text-meta font-semibold">Keep meetings planned ahead</p>
              <div role="group" aria-label="Meetings to keep planned ahead" className="flex flex-wrap gap-2">
                {KEEP_AHEAD_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={busy || offline || keepAhead === null || cadence === "NONE"}
                    aria-pressed={keepAhead === n}
                    onClick={() => void saveKeepAhead(n)}
                    className={chipCls(keepAhead === n)}
                  >
                    {n === 0 ? "Off" : n}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-meta text-muted-foreground">
                {cadence === "NONE"
                  ? "Pick how often it repeats first."
                  : "New meetings copy the latest one (time, length, place, link, people) and block your calendar. A meeting you cancel stays cancelled."}
              </p>
            </div>
          )}

          <div aria-live="polite">
            {msg && <p className="text-meta font-semibold text-success-text">{msg}</p>}
            {error && (
              <Notice tone="danger" title="Couldn't save">
                {error}
              </Notice>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
