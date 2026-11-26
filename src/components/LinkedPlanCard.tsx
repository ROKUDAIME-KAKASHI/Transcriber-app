"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, FileText, MapPin, Repeat, Users, Video } from "lucide-react";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { attendeeLine, whenText, type PlanDTO } from "@/lib/planning";
import { isHttpUrl } from "@/lib/planning";
import { Panel, cx } from "./ui";
import { PlanNextButton } from "./PlanNextButton";

/**
 * The plan a recording was started from: agenda, attendees, venue or link. Shown above the tabs on the meeting page.
 * Needs internet; offline, switched off, not migrated or no plan: renders nothing.
 */
export function LinkedPlanCard({ meetingId, className }: { meetingId: string; className?: string }) {
  const on = useFlag("plannedMeetings");
  const online = useConnectivity() !== "offline";
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [open, setOpen] = useState(false);
  const followOn = useFlag("followUpPlanning");
  const [previous, setPrevious] = useState<{ meetingId: string; title: string } | null>(null);
  const preworkOn = useFlag("prework");
  const [refs, setRefs] = useState<{ id: string; fileName: string; points: unknown[] | null }[]>([]);

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

  useEffect(() => {
    if (!on || !followOn || !online) return;
    let cancelled = false;
    void fetch(`/api/meetings/${encodeURIComponent(meetingId)}/follow-up`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { previous?: { meetingId: string; title: string } | null } | null) => {
        if (!cancelled) setPrevious(j?.previous ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [on, followOn, online, meetingId]);

  const planId = plan?.id;
  useEffect(() => {
    if (!on || !preworkOn || !online || !planId) return;
    let cancelled = false;
    void fetch(`/api/plans/${encodeURIComponent(planId)}/references`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { references?: { id: string; fileName: string; points: unknown[] | null }[] } | null) => {
        if (!cancelled) setRefs(j?.references ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [on, preworkOn, online, planId]);

  if (!on || !plan) return null;
  const hasAgenda = !!plan.agenda?.trim();
  return (
    <Panel aria-label="Planned meeting" className={cx("p-4", className)}>
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-meta font-semibold text-muted-foreground">Planned meeting</p>
          <p className="text-ui font-semibold">{plan.title}</p>
          {followOn && previous && (
            <p className="text-meta text-muted-foreground">
              Follow-up of{" "}
              <Link href={`/meeting?id=${encodeURIComponent(previous.meetingId)}`} className="font-semibold text-accent-text underline underline-offset-2">
                {previous.title}
              </Link>
            </p>
          )}
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
                <a href={plan.callUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-semibold text-accent-text underline underline-offset-2">
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
              <Link href={`/plan?id=${plan.id}`} className="font-semibold text-accent-text underline underline-offset-2">
                {plan.series.title}
              </Link>
            </p>
          )}
          {preworkOn && refs.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-meta font-semibold text-muted-foreground">Pre-work</p>
              <ul className="space-y-0.5">
                {refs.map((r) => (
                  <li key={r.id} className="flex items-start gap-1.5 text-meta text-muted-foreground">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {r.fileName}
                      {r.points ? ` · ${r.points.length} ${r.points.length === 1 ? "point" : "points"}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.status === "RECORDED" && <PlanNextButton meetingId={meetingId} className="mt-1" />}
          {hasAgenda && (
            <div>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-accent-text"
              >
                Agenda <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
              {open && <p className="whitespace-pre-line rounded-chip bg-muted px-3 py-2 text-meta text-foreground">{plan.agenda}</p>}
            </div>
          )}
        </div>
        <Link href={`/plan?id=${plan.id}`} className="inline-flex min-h-11 shrink-0 items-center px-2 text-meta font-semibold text-accent-text">
          Open
        </Link>
      </div>
    </Panel>
  );
}
