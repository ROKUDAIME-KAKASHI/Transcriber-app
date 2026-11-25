"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Send, Trash2, WifiOff } from "lucide-react";
import { useFeatureGate } from "@/lib/featureGate";
import { MAX_QUESTION_CHARS, trimHistory, type AskQuote } from "@/lib/askMeeting";
import { flush } from "@/lib/local/sync";
import { useLocalUser } from "./SyncProvider";
import { Button, Panel, PanelHeader, cx, inputCls } from "./ui";

interface Turn {
  id: number;
  q: string;
  a: string;
  quotes: AskQuote[];
}

const key = (id: string) => `minutely.ask.${id}`;
const MAX_KEPT = 30;

function load(id: string): Turn[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? "[]");
    return Array.isArray(v) ? (v as Turn[]).filter((t) => t && typeof t.q === "string" && typeof t.a === "string").slice(-MAX_KEPT) : [];
  } catch {
    return [];
  }
}

function save(id: string, turns: Turn[]) {
  try {
    if (turns.length) localStorage.setItem(key(id), JSON.stringify(turns.slice(-MAX_KEPT)));
    else localStorage.removeItem(key(id));
  } catch {
    /* storage full or blocked: the chat just isn't remembered */
  }
}

/** Ask about this meeting. The chat stays on this device; the server only sees the question and the last few turns. */
export function AskTab({ meetingId, hasTranscript }: { meetingId: string; hasTranscript: boolean }) {
  const { userId } = useLocalUser();
  const gate = useFeatureGate("ai");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const t = load(meetingId);
    nextId.current = t.reduce((n, x) => Math.max(n, x.id), 0) + 1;
    setTurns(t);
  }, [meetingId]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns.length, busy]);

  const ask = async () => {
    const q = text.trim();
    if (q.length < 2 || busy || !gate.enabled || !hasTranscript) return;
    setBusy(true);
    setError(null);
    try {
      // The server answers from its own copy of the transcript, so a fresh recording has to be uploaded first.
      if (userId) {
        const r = await flush(meetingId, { timeoutMs: 15_000 });
        if (r !== "synced") {
          setError("Waiting to upload this meeting. Connect to the internet and try again.");
          return;
        }
      }
      const res = await fetch(`/api/meetings/${meetingId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: trimHistory(turns.map((t) => ({ q: t.q, a: t.a }))) }),
      });
      const data = (await res.json().catch(() => null)) as { answer?: string; quotes?: AskQuote[]; error?: string } | null;
      if (!res.ok || !data?.answer) {
        setError(
          res.status === 404
            ? "Ask isn't available right now."
            : (data?.error ?? "Couldn't get an answer. Try again.")
        );
        return;
      }
      const next = [...turns, { id: nextId.current++, q, a: data.answer, quotes: Array.isArray(data.quotes) ? data.quotes : [] }].slice(-MAX_KEPT);
      setTurns(next);
      save(meetingId, next);
      setText("");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = !hasTranscript ? "This meeting has no transcript to ask about." : !gate.enabled ? gate.reason : null;

  return (
    <Panel aria-label="Ask about this meeting">
      <PanelHeader title="Ask about this meeting">
        {turns.length > 0 && (
          <Button
            variant="ghost"
            className="!min-h-11 px-2 text-meta"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            onClick={() => {
              setTurns([]);
              save(meetingId, []);
            }}
          >
            Clear chat
          </Button>
        )}
      </PanelHeader>
      <div className="space-y-4 p-5">
        {turns.length === 0 && (
          <p className="text-ui text-muted-foreground">
            Ask things like &ldquo;What did we decide about the budget?&rdquo; or &ldquo;Who agreed to send the report?&rdquo;. Answers
            come with short quotes from the transcript. This chat is kept on this device only.
          </p>
        )}
        <ul className="space-y-4" aria-live="polite">
          {turns.map((t) => (
            <li key={t.id} className="space-y-2">
              <p className="text-ui font-semibold">{t.q}</p>
              <div className="rounded-chip border border-border/70 bg-muted/30 p-3 text-ui">
                <p className="whitespace-pre-wrap break-words">{t.a}</p>
                {t.quotes.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-border/70 pt-3">
                    {t.quotes.map((qt, i) => (
                      <li key={i} className="text-meta">
                        <p className="break-words text-muted-foreground">
                          &ldquo;{qt.quote}&rdquo;
                          {(qt.speaker || qt.time) && (
                            <span className="ml-1">
                              ({[qt.speaker, qt.time].filter(Boolean).join(", ")})
                            </span>
                          )}
                        </p>
                        {qt.verified ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Found in transcript
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Quote not found in transcript
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {t.quotes.length === 0 && <p className="mt-2 text-meta text-muted-foreground">No quote to back this up.</p>}
              </div>
            </li>
          ))}
        </ul>
        {busy && (
          <p role="status" className="text-meta text-muted-foreground">
            Looking through the transcript…
          </p>
        )}
        <div ref={endRef} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
          className="space-y-2"
        >
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-input"
            rows={2}
            maxLength={MAX_QUESTION_CHARS}
            value={text}
            disabled={!!disabledReason}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder="Ask a question about this meeting"
            aria-describedby={disabledReason ? "ask-gate" : undefined}
            className={cx(inputCls, "min-h-12 resize-y py-2")}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-muted-foreground tabular-nums">
              {text.length}/{MAX_QUESTION_CHARS}
            </span>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!!disabledReason || text.trim().length < 2}
              icon={<Send className="h-4 w-4" aria-hidden />}
            >
              Ask
            </Button>
          </div>
        </form>
        {disabledReason && (
          <p id="ask-gate" className="flex items-center gap-1.5 text-meta text-muted-foreground">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            {disabledReason === "Needs internet" ? "Asking needs internet. Your earlier questions stay here." : disabledReason}
          </p>
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
