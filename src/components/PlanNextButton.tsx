"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { useFlag } from "@/lib/flagsClient";
import { useConnectivity } from "@/lib/connectivity";
import { localToday } from "@/lib/taskTracker";
import { carriedLabel } from "@/lib/followUp";
import type { PlanDTO } from "@/lib/planning";
import { useToast } from "./Toast";
import { Button } from "./ui";

/**
 * "Plan next meeting": creates (or finds) the next planned meeting with unfinished tasks carried into its agenda,
 * then opens it. Give it the recorded plan (`planId`) or the recorded meeting (`meetingId`). Renders nothing when
 * the feature or planning is switched off. Needs internet; a database that isn't updated yet shows the server's message.
 */
export function PlanNextButton({
  planId,
  meetingId,
  variant = "secondary",
  className,
  onOpen,
}: {
  planId?: string;
  meetingId?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  /** Called just before navigating, e.g. to close a sheet. */
  onOpen?: () => void;
}) {
  const on = useFlag("followUpPlanning");
  const plansOn = useFlag("plannedMeetings");
  const offline = useConnectivity() === "offline";
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!on || !plansOn || (!planId && !meetingId)) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = planId ? `/api/plans/${encodeURIComponent(planId)}/follow-up` : `/api/meetings/${encodeURIComponent(meetingId ?? "")}/follow-up`;
      let timeZone = "UTC";
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        /* keep UTC */
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today: localToday(), timeZone }),
      });
      const j = (await res.json().catch(() => null)) as { plan?: PlanDTO; existing?: boolean; carried?: number; error?: string } | null;
      if (!res.ok || !j?.plan) {
        toast(j?.error || "Couldn't plan the next meeting. Try again.", "danger");
        return;
      }
      const n = j.carried ?? 0;
      toast(`${j.existing ? "Next meeting is already planned" : "Next meeting planned"}${n ? ` · ${carriedLabel(n)}` : ""}`, "success");
      onOpen?.();
      router.push(`/plan?id=${encodeURIComponent(j.plan.id)}`);
    } catch {
      toast("Couldn't reach the server. Check the connection and try again.", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={variant}
      className={className}
      loading={busy}
      disabled={offline}
      title={offline ? "Planning needs internet" : undefined}
      icon={<CalendarPlus className="h-4 w-4" aria-hidden />}
      onClick={() => void run()}
    >
      Plan next meeting
    </Button>
  );
}
