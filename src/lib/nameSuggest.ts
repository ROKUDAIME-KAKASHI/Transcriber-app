"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kvGet, kvSet } from "@/lib/local/repo";
import {
  buildNameExcerpt,
  detectSelfIntroductions,
  dismissKey,
  mergeSuggestions,
  transcriptFingerprint,
  type NameSuggestion,
  type SpeakerNamesRequest,
  type SpeakerNamesResponse,
} from "@/lib/nameDetect";
import type { SpeakerNames, TranscriptPart } from "@/lib/transcript";

interface Stored {
  v: 1;
  dismissed: string[];
  ai?: { fp: string; at: number; items: NameSuggestion[] };
}

const kvKey = (meetingId: string) => `names:${meetingId}`;

/**
 * Speaker-name suggestions for one meeting. Device rules run automatically (offline, never applied
 * without a tap); the AI runs only from `askAi()`. Dismissals and the AI result live in the device-only
 * Dexie kv table.
 */
export function useNameSuggestions({
  meetingId,
  userId,
  parts,
  names,
  enabled,
}: {
  meetingId: string | null;
  userId: string | null;
  parts: TranscriptPart[];
  names: SpeakerNames;
  enabled: boolean;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [ai, setAi] = useState<Stored["ai"]>(undefined);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAsked, setAiAsked] = useState(false);
  const storedRef = useRef<Stored>({ v: 1, dismissed: [] });

  useEffect(() => {
    let alive = true;
    setDismissed([]);
    setAi(undefined);
    setAiAsked(false);
    storedRef.current = { v: 1, dismissed: [] };
    if (!enabled || !userId || !meetingId) return;
    void kvGet<Stored>(userId, kvKey(meetingId)).then((s) => {
      if (!alive || !s || s.v !== 1) return;
      storedRef.current = s;
      setDismissed(Array.isArray(s.dismissed) ? s.dismissed : []);
      setAi(s.ai);
    });
    return () => {
      alive = false;
    };
  }, [enabled, userId, meetingId]);

  const persist = useCallback(
    (patch: Partial<Stored>) => {
      storedRef.current = { ...storedRef.current, ...patch, v: 1 };
      if (userId && meetingId) void kvSet(userId, kvKey(meetingId), storedRef.current);
    },
    [userId, meetingId]
  );

  const fp = useMemo(() => transcriptFingerprint(parts), [parts]);
  const device = useMemo(() => (enabled ? detectSelfIntroductions(parts, { names }) : []), [enabled, parts, names]);
  const aiItems = useMemo(() => (ai && ai.fp === fp ? ai.items : []), [ai, fp]);
  const suggestions = useMemo(
    () => (enabled ? mergeSuggestions(device, aiItems, { names, dismissed }) : []),
    [enabled, device, aiItems, names, dismissed]
  );

  const speakerCount = useMemo(() => new Set(parts.map((p) => p.speaker)).size, [parts]);
  const unnamed = useMemo(
    () => [...new Set(parts.map((p) => p.speaker))].filter((n) => !names?.[String(n)]?.trim()).length,
    [parts, names]
  );

  const dismiss = useCallback(
    (s: NameSuggestion) => {
      const next = [...new Set([...storedRef.current.dismissed, dismissKey(s.speaker, s.name)])];
      setDismissed(next);
      persist({ dismissed: next });
    },
    [persist]
  );

  const askAi = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const lines = buildNameExcerpt(parts, { hintNames: device.map((d) => d.name) });
      const named: Record<string, string> = {};
      for (const [k, v] of Object.entries(names ?? {})) if (typeof v === "string" && v.trim()) named[k] = v.trim();
      const body: SpeakerNamesRequest = { lines, named, model: "glm" };
      const res = await fetch("/api/speaker-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<SpeakerNamesResponse>;
      if (!res.ok) {
        setAiError(data.error || "Couldn't find names. Try again.");
        return;
      }
      const present = new Set(parts.map((p) => p.speaker));
      const items = (Array.isArray(data.suggestions) ? data.suggestions : [])
        .filter((s) => s && typeof s.name === "string" && typeof s.speaker === "number" && present.has(s.speaker))
        .map((s) => ({ ...s, name: s.name.slice(0, 40), source: "ai" as const }));
      const next = { fp, at: Date.now(), items };
      setAi(next);
      setAiAsked(true);
      persist({ ai: next });
    } catch {
      setAiError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, parts, device, names, fp, persist]);

  return { suggestions, askAi, dismiss, aiBusy, aiError, aiAsked, speakerCount, unnamed };
}
