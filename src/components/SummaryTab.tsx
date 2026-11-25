"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import { useFlag } from "@/lib/flagsClient";
import { generateSummaryOnly } from "@/lib/minutesJob";
import { useExtras, writeExtras } from "@/lib/meetingExtras";
import { Button, GateReason, Panel, PanelHeader } from "./ui";

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
export function SummaryTab({ meetingId, hasTranscript, model }: { meetingId: string; hasTranscript: boolean; model: string }) {
  const { summary } = useExtras(meetingId);
  const gate = useFeatureGate("ai");
  const aiOn = useFlag("autoMinutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      writeExtras(meetingId, { summary: await generateSummaryOnly(meetingId, model) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the summary. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!summary) {
    return (
      <Panel aria-label="Summary">
        <PanelHeader title="Summary" />
        <div className="space-y-3 p-5">
          <p className="text-ui text-muted-foreground">
            A short look at how the meeting went: why it was held, the main points, decisions, open questions and the tone. It is
            written together with the minutes{aiOn ? "" : " when automatic minutes are switched on"}, and kept on this device.
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
                aria-describedby={gate.reason ? "summary-gate" : undefined}
                onClick={() => void write()}
              >
                {busy ? "Writing…" : "Write summary"}
              </Button>
              <GateReason id="summary-gate" reason={gate.reason} />
            </>
          )}
          {error && (
            <p className="text-meta text-danger" role="alert">
              {error}
            </p>
          )}
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
        {error && (
          <p className="text-meta text-danger" role="alert">
            {error}
          </p>
        )}
        <p className="text-meta text-muted-foreground">Kept on this device. Regenerating the minutes writes a new summary.</p>
      </div>
    </Panel>
  );
}
