"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCw, WifiOff } from "lucide-react";
import { etaLabel } from "@/lib/autoMinutesCore";
import { useJob } from "@/lib/minutesJob";
import { Button, cx } from "./ui";

/** Progress of the automatic minutes for one meeting: waiting, writing with a countdown, or an error with Try again. */
export function MinutesStatus({ meetingId, onRetry, className }: { meetingId: string; onRetry: () => void; className?: string }) {
  const job = useJob(meetingId);
  const [now, setNow] = useState(() => Date.now());
  const writing = job?.phase === "writing";
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [writing]);

  if (!job || job.phase === "done") return null;
  const box = cx("rounded-chip border border-border/70 bg-muted/40 px-4 py-3 text-ui", className);

  if (job.phase === "error") {
    return (
      <div role="alert" className={cx(box, "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between")}>
        <p className="text-danger-text">{job.error ?? "Couldn't write the minutes."}</p>
        <Button icon={<RotateCw className="h-4 w-4" aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (job.phase === "waiting") {
    return (
      <div role="status" className={cx(box, "flex items-center gap-2 text-muted-foreground")}>
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        Minutes will be written as soon as you are online and signed in.
      </div>
    );
  }
  const elapsed = job.startedAt ? (now - job.startedAt) / 1000 : 0;
  const left = Math.max(0, job.etaSec - elapsed);
  const pct = job.phase === "uploading" ? 8 : Math.min(95, Math.max(8, (elapsed / job.etaSec) * 100));
  return (
    <div role="status" aria-live="polite" className={box}>
      <p className="flex items-center gap-2 font-semibold">
        <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden />
        {job.phase === "uploading"
          ? "Saving the transcript first…"
          : left > 1
            ? `Writing minutes — ready in ${etaLabel(left)}`
            : "Writing minutes — almost there…"}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/60" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
