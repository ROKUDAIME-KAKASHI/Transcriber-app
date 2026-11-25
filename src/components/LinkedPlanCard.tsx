"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, MapPin, Repeat, Users, Video } from "lucide-react";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { attendeeLine, whenText, type PlanDTO } from "@/lib/planning";
import { isHttpUrl } from "@/lib/planning";
import { Panel, cx } from "./ui";

/**
 * The plan a recording was started from: agenda, attendees, venue or link. Shown above the tabs on the meeting page.
 * Needs internet; offline, switched off, not migrated or no plan: renders nothing.
 */
export function LinkedPlanCard({ meetingId, className }: { meetingId: string; className?: string }) {
  const on = useFlag("plannedMeetings");
  const online = useConnectivity() !== "offline";
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!on || !online) return;
    let cancelled = false;
    void fetch(`/api/meetings/${encodeURIComponent(meetingId)}/plan`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { plan?: PlanDTO | null } | null) => {
        if (!cancelled) setPlan(j?.plan ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [on, online, meetingId]);

  if (!on || !plan) return null;
  const hasAgenda = !!plan.agenda?.trim();
  return (
    <Panel aria-label="Planned meeting" className={cx("p-4", className)}>
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-meta font-semibold text-muted-foreground">Planned meeting</p>
          <p className="text-ui font-semibold">{plan.title}</p>
          <p className="text-meta tabular-nums text-muted-foreground">{whenText(plan)}</p>
          {plan.venue && (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{plan.venue}</span>
            </p>
          )}
          {plan.callUrl && (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {isHttpUrl(plan.callUrl) ? (
                <a href={plan.callUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-semibold text-accent underline underline-offset-2">
                  {plan.callUrl}
                </a>
              ) : (
                <span className="min-w-0 break-all">{plan.callUrl}</span>
              )}
            </p>
          )}
          {plan.attendees.length > 0 && (
            <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">{plan.attendees.map(attendeeLine).join(", ")}</span>
            </p>
          )}
          {plan.series && (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <Repeat className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <Link href={`/plan?id=${plan.id}`} className="font-semibold text-accent underline underline-offset-2">
                {plan.series.title}
              </Link>
            </p>
          )}
          {hasAgenda && (
            <div>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-accent"
              >
                Agenda <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
              {open && <p className="whitespace-pre-line rounded-chip bg-muted px-3 py-2 text-meta text-foreground">{plan.agenda}</p>}
            </div>
          )}
        </div>
        <Link href={`/plan?id=${plan.id}`} className="inline-flex min-h-11 shrink-0 items-center px-2 text-meta font-semibold text-accent">
          Open
        </Link>
      </div>
    </Panel>
  );
}
