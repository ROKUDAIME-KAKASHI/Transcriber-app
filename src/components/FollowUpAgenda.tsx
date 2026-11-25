"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarClock, Copy, RotateCcw, Share2, Sparkles, X } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import { pushOverlay } from "@/lib/overlays";
import { copyText, shareOrSave, shareText } from "@/lib/export/deliver";
import { useConnectivity } from "@/lib/connectivity";
import { agendaFileName, buildAgendaDraft, type AgendaItem } from "@/lib/followUpAgenda";
import { localToday } from "@/lib/taskTracker";
import { useFlag } from "@/lib/flagsClient";
import { useToast } from "./Toast";
import { PlanNextButton } from "./PlanNextButton";
import { Button, GateReason, cx, inputCls } from "./ui";

/** Button that asks for the agenda; the parent decides which tasks feed it. */
export function AgendaButton(props: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const on = useFlag("followUpAgenda");
  if (!on) return null;
  return (
    <Button
      loading={props.loading}
      disabled={props.disabled}
      aria-describedby={props.describedBy}
      className={props.className}
      icon={<CalendarCheck className="h-4 w-4" aria-hidden />}
      onClick={props.onClick}
    >
      Prepare follow-up agenda
    </Button>
  );
}

/** Editable follow-up agenda. The draft is built without AI; "Polish with AI" is optional. */
export function FollowUpAgendaSheet({
  open,
  onClose,
  items,
  meetingTitle,
  meetingId = null,
}: {
  open: boolean;
  onClose: () => void;
  items: AgendaItem[];
  meetingTitle: string | null;
  /** The meeting this agenda follows up on, when it is a single meeting. */
  meetingId?: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const offline = useConnectivity() === "offline";
  const [scheduling, setScheduling] = useState(false);
  const aiGate = useFeatureGate("ai");
  const draft = useMemo(
    () => buildAgendaDraft(items, { meetingTitle, today: localToday() }),
    [items, meetingTitle]
  );
  const [text, setText] = useState(draft);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** The text as it was just before the last AI polish, so "Undo polish" can bring it back. */
  const [beforePolish, setBeforePolish] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // A fresh draft each time the sheet opens (or its tasks change while closed).
  useEffect(() => {
    if (open) {
      setText(draft);
      setError(null);
      setBeforePolish(null);
    }
  }, [open, draft]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Android back and Escape close it; the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const unregister = pushOverlay(() => onCloseRef.current());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the sheet: wrap from the last control to the first and back.
      const box = dialogRef.current;
      if (!box) return;
      const focusable = Array.from(
        box.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
      );
      if (!focusable.length) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!current || !box.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const active = document.activeElement as HTMLElement | null;
    const focusId = requestAnimationFrame(() => areaRef.current?.focus());
    return () => {
      unregister();
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      cancelAnimationFrame(focusId);
      active?.focus?.();
    };
  }, [open]);

  // Grow the textarea to fit its text.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || !open) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, open]);

  if (!open) return null;

  const copy = async () => {
    try {
      await copyText(text);
      toast("Agenda copied", "success");
    } catch {
      toast("Couldn't copy. Select the text and copy it by hand.", "danger");
    }
  };

  const share = async () => {
    const title = meetingTitle?.trim() || "Selected tasks";
    try {
      const body = text.endsWith("\n") ? text : `${text}\n`;
      await shareOrSave(
        {
          kind: "txt",
          name: agendaFileName(title),
          mime: "text/plain",
          blob: new Blob([body], { type: "text/plain;charset=utf-8" }),
          text: body,
        },
        `Follow-up agenda — ${title}`
      );
    } catch {
      // Sharing a file can be unavailable (old app build, blocked share); the text still copies.
      try {
        await copyText(text);
        toast("Sharing isn't available here. Agenda copied instead.", "neutral");
      } catch {
        toast("Couldn't share the agenda. Try Copy.", "danger");
      }
    }
  };

  /** Save the agenda, then share a booking link that carries it. No handle yet: go set one up. */
  const scheduleFollowUp = async () => {
    if (!text.trim() || scheduling) return;
    setError(null);
    setScheduling(true);
    try {
      const sres = await fetch("/api/schedule/settings", { cache: "no-store" });
      const settings = (await sres.json().catch(() => null)) as {
        error?: string;
        handle?: string | null;
        eventTypes?: { id: string | null; slug: string; active: boolean }[];
      } | null;
      if (!sres.ok || !settings) {
        setError(settings?.error || "Couldn't check your booking link. Try again.");
        return;
      }
      const slug = settings.eventTypes?.find((e) => e.id && e.active)?.slug;
      if (!settings.handle || !slug) {
        onCloseRef.current();
        toast("Set up your booking link first, then come back.", "neutral");
        router.push("/schedule");
        return;
      }
      const res = await fetch("/api/schedule/agenda-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, followUpFromMeetingId: meetingId }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setError(data?.error || "Couldn't create the link. Try again.");
        return;
      }
      const url = `${window.location.origin}/book/${settings.handle}/${slug}?agenda=${data.id}`;
      const r = await shareText(url, `Book a follow-up${meetingTitle?.trim() ? `: ${meetingTitle.trim()}` : ""}`);
      if (r === "copied") toast("Booking link copied", "success");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setScheduling(false);
    }
  };

  const polish = async () => {
    if (!text.trim() || polishing) return;
    setError(null);
    setPolishing(true);
    const snapshot = text;
    try {
      const res = await fetch("/api/agenda/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: text }),
      });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!res.ok || !data?.text) {
        setError(data?.error || "Couldn't polish the agenda. Try again.");
        return;
      }
      setBeforePolish(snapshot);
      setText(data.text);
      toast("Agenda polished. Check it before sharing.", "success");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setPolishing(false);
    }
  };

  const gateReason = !aiGate.enabled ? aiGate.reason : null;

  return (
    <>
      <div
        className={cx(
          "fixed inset-0 z-40 bg-black/40 transition-opacity motion-reduce:transition-none",
          shown ? "opacity-100 duration-[var(--dur-2)]" : "opacity-0 duration-150"
        )}
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="agenda-title"
          className={cx(
            "pointer-events-auto safe-bottom flex max-h-[90dvh] w-full flex-col rounded-t-panel border border-border/70 bg-card shadow-float transition-[transform,opacity] motion-reduce:transition-none lg:max-w-2xl lg:rounded-panel",
            shown ? "translate-y-0 opacity-100 duration-[var(--dur-3)] ease-[var(--ease-in-out)]" : "translate-y-8 opacity-0 duration-150 ease-in"
          )}
        >
          <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
            <h2 id="agenda-title" className="min-w-0 flex-1 text-ui font-semibold">
              Follow-up agenda
            </h2>
            <Button variant="ghost" className="!min-h-11 !min-w-11 px-0" onClick={onClose} aria-label="Close follow-up agenda">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <label className="block text-meta font-semibold text-muted-foreground" htmlFor="agenda-text">
              Edit the agenda before you share it
            </label>
            <textarea
              id="agenda-text"
              ref={areaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={8000}
              disabled={polishing}
              spellCheck
              className={cx(inputCls, "min-h-40 resize-none overflow-hidden py-3 leading-6")}
            />
            {error && (
              <p className="text-meta text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                loading={polishing}
                disabled={!aiGate.enabled || !text.trim()}
                aria-describedby={gateReason ? "agenda-gate" : undefined}
                icon={<Sparkles className="h-4 w-4" aria-hidden />}
                onClick={() => void polish()}
              >
                {polishing ? "Polishing…" : "Polish with AI"}
              </Button>
              {beforePolish !== null && !polishing && (
                <Button
                  variant="ghost"
                  icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    setText(beforePolish);
                    setBeforePolish(null);
                  }}
                >
                  Undo polish
                </Button>
              )}
              <GateReason id="agenda-gate" reason={gateReason} />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/70 p-4 sm:flex-row sm:items-center">
            <Button
              variant="ghost"
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              disabled={text === draft}
              onClick={() => {
                setText(draft);
                setError(null);
              }}
              className="sm:mr-auto"
            >
              Reset to draft
            </Button>
            <Button
              loading={scheduling}
              icon={<CalendarClock className="h-4 w-4" aria-hidden />}
              onClick={() => void scheduleFollowUp()}
              disabled={!text.trim() || offline}
              title={offline ? "Scheduling needs internet" : undefined}
            >
              Schedule follow-up
            </Button>
            {meetingId && <PlanNextButton meetingId={meetingId} onOpen={() => onCloseRef.current()} />}
            <Button icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => void copy()} disabled={!text.trim()}>
              Copy
            </Button>
            <Button
              variant="primary"
              icon={<Share2 className="h-4 w-4" aria-hidden />}
              onClick={() => void share()}
              disabled={!text.trim()}
            >
              Share
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
