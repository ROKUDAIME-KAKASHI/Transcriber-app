"use client";

import { useEffect, useState } from "react";
import { ClipboardCopy } from "lucide-react";
import { loadNamingStats, useScreenNamingOptIn } from "@/lib/naming/client";
import { formatReport, namesChanged, type NamingStats } from "@/lib/naming/stats";
import { speakerLabel, type SpeakerNames } from "@/lib/transcript";
import { useFlag } from "@/lib/flagsClient";
import { Button } from "./ui";
import { useToast } from "./Toast";

/**
 * The owner's accuracy check for screen naming (beta): what was read, what was set, what you changed afterwards.
 * Kept on this device only. Shown on the Transcript tab only while this device has the beta switched on and the
 * meeting actually used it.
 */
export function NamingReport({ userId, meetingId, names }: { userId: string | null; meetingId: string; names: SpeakerNames }) {
  const flag = useFlag("screenNaming");
  const [optIn] = useScreenNamingOptIn();
  const toast = useToast();
  const [stats, setStats] = useState<NamingStats | null>(null);

  useEffect(() => {
    let alive = true;
    if (!flag || !optIn || !userId) {
      setStats(null);
      return;
    }
    void loadNamingStats(userId, meetingId).then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
    // `names` changes when you rename a voice, which updates the stored counts first.
  }, [flag, optIn, userId, meetingId, names]);

  if (!stats || (stats.reads === 0 && stats.auto.length === 0)) return null;
  const text = formatReport(stats, { speakerLabel: (n) => speakerLabel(n, null) });
  const screen = stats.auto.filter((a) => a.source === "screen");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Report copied", "success");
    } catch {
      toast("Couldn't copy. Select the text and copy it.", "danger");
    }
  };
  return (
    <section className="mb-5 rounded-card border border-border bg-muted/40 p-4" aria-label="Naming report">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-ui font-semibold">Naming report (beta)</h3>
          <p className="mt-0.5 text-meta text-muted-foreground">
            {screen.length} name{screen.length === 1 ? "" : "s"} read from the call screen, {namesChanged(stats)} changed by you, {stats.reads} screen read
            {stats.reads === 1 ? "" : "s"}. Only on this device.
          </p>
        </div>
        <Button variant="secondary" icon={<ClipboardCopy className="h-4 w-4" aria-hidden />} onClick={() => void copy()}>
          Copy report
        </Button>
      </div>
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-chip bg-card p-3 text-meta text-muted-foreground">{text}</pre>
    </section>
  );
}
