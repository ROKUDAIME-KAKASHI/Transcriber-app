"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Mic } from "lucide-react";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { formatInZone } from "@/lib/scheduling";
import { nextUpPlan, type PlanDTO } from "@/lib/planning";
import { cx } from "./ui";

/**
 * "Next up" on the Record screen: a planned meeting starting from 15 minutes ago to 30 minutes from now.
 * Online only and quiet: no plan, no internet, the feature off or the database not updated all show nothing.
 */
export function NextUpCard({ onRecord, disabled, className }: { onRecord: (plan: PlanDTO) => void; disabled?: boolean; className?: string }) {
  const on = useFlag("plannedMeetings");
  const online = useConnectivity() !== "offline";
  const [plan, setPlan] = useState<PlanDTO | null>(null);

  useEffect(() => {
    if (!on || !online) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const now = Date.now();
      const q = new URLSearchParams({ from: new Date(now - 60 * 60_000).toISOString(), to: new Date(now + 60 * 60_000).toISOString() });
      try {
        const r = await fetch(`/api/plans?${q}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { plans?: PlanDTO[] };
        if (!cancelled) setPlan(nextUpPlan(j.plans ?? [], new Date()));
      } catch {
        /* offline or server busy: no card */
      }
    };
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [on, online]);

  if (!plan) return null;
  return (
    <div className={cx("flex items-center gap-3 border-b border-border px-4 py-3", className)}>
      <CalendarClock className="h-4 w-4 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-meta text-muted-foreground">Next up</p>
        <p className="truncate text-ui font-semibold">{plan.title}</p>
        <p className="text-meta tabular-nums text-muted-foreground">{formatInZone(plan.startAt, plan.timeZone, false)}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRecord(plan)}
        aria-label={`Record ${plan.title}`}
        className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-ui font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-50 lg:min-h-10"
      >
        <Mic className="h-4 w-4" aria-hidden /> Record
      </button>
    </div>
  );
}
