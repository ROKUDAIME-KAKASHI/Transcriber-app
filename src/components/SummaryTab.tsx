"use client";

import { useEffect, useState } from "react";
import type { MeetingSummary } from "@/lib/combined";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import { useFlag } from "@/lib/flagsClient";
import { generateSummaryOnly } from "@/lib/minutesJob";
import { useLocalUser } from "./SyncProvider";
import { useExtras, writeExtras } from "@/lib/meetingExtras";
import { Button, GateReason, Notice, Panel, PanelHeader } from "./ui";

function List({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-meta font-semibold text-muted-foreground">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-ui">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** "How the meeting went": purpose, key points, decisions, open questions and tone. Kept on this device. */
export function SummaryTab({
  meetingId,
  hasTranscript,
  model,
  compact = false,
}: {
  meetingId: string;
  hasTranscript: boolean;
  model: string;
  /** Shown at the top of the Minutes tab: with no summary yet, only a slim row (or nothing). */
  compact?: boolean;
}) {
  const { userId } = useLocalUser();
  const { summary: local } = useExtras(userId, meetingId);
  // The saved copy on the server wins; the device copy is the fallback (offline, or the database update is not applied).
  const [saved, setSaved] = useState<MeetingSummary | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/meetings/${meetingId}/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { summary?: MeetingSummary | null } | null) => live && d?.summary && setSaved(d.summary))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meetingId]);
  const summary = saved ?? local;
  const gate = useFeatureGate("ai");
  const aiOn = useFlag("autoMinutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await generateSummaryOnly(meetingId, model);
      writeExtras(userId, meetingId, { summary: next });
      setSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the summary. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!summary && compact) {
    if (!aiOn || !hasTranscript || !gate.enabled) return null;
    return (
      <Panel aria-label="Summary" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="text-ui text-muted-foreground">No summary yet.</p>
        <Button size="lg" loading={busy} icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={() => void write()}>
          {busy ? "Writing…" : "Write summary"}
        </Button>
        {error && <div className="w-full"><Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" aria-hidden />} title={error} /></div>}
      </Panel>
    );
  }

  if (!summary) {
    return (
      <Panel aria-label="Summary">
        <PanelHeader title="Summary" />
        <div className="space-y-3 p-5">
          <p className="text-ui text-muted-foreground">
            A short look at how the meeting went: why it was held, the main points, decisions, open questions and the tone. It is
            written together with the minutes{aiOn ? "" : " when automatic minutes are on"}.
          </p>
          {aiOn && (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                loading={busy}
                icon={<Sparkles className="h-4 w-4" aria-hidden />}
                disabled={!hasTranscript || !gate.enabled}
                aria-describedby={gate.reason || !hasTranscript ? "summary-gate" : undefined}
                onClick={() => void write()}
              >
                {busy ? "Writing…" : "Write summary"}
              </Button>
              <GateReason id="summary-gate" reason={gate.reason ?? (hasTranscript ? null : "This meeting has no transcript to summarise.")} />
            </>
          )}
          {error && <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" aria-hidden />} title={error} />}
        </div>
      </Panel>
    );
  }

  return (
    <Panel aria-label="Summary" className="px-5 py-6 sm:px-8 sm:py-8">
      <div className="max-w-[72ch] space-y-5">
        {summary.purpose && (
          <section>
            <h3 className="mb-1.5 text-meta font-semibold text-muted-foreground">Purpose</h3>
            <p className="text-reading">{summary.purpose}</p>
          </section>
        )}
        <List title="Key points" items={summary.keyPoints} />
        <List title="Decisions" items={summary.decisions} empty="No decisions recorded." />
        <List title="Open questions" items={summary.openQuestions} empty="None recorded." />
        {summary.tone && (
          <section>
            <h3 className="mb-1.5 text-meta font-semibold text-muted-foreground">How it went</h3>
            <p className="text-ui">{summary.tone}</p>
          </section>
        )}
        {error && <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" aria-hidden />} title={error} />}
        <p className="text-meta text-muted-foreground">Saved with the meeting. Regenerating the minutes writes a new summary.</p>
      </div>
    </Panel>
  );
}
