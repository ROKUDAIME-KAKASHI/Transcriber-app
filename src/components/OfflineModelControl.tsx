"use client";

/**
 * "Offline use" panel: download the on-device models once, see whether they are really saved
 * (readiness comes from Cache Storage, never from a flag alone), and record with no internet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download } from "lucide-react";
import { Badge, Button, Panel } from "@/components/ui";
import { useConnectivity } from "@/lib/connectivity";
import { chainFor, labelSize, needsSpeakerDownload, NOT_READY_OFFLINE, totalSizeMb, type ReadinessStatus } from "@/lib/speech/readiness";
import { engineStatus, prefetchEngine, type EngineReadiness } from "@/lib/speech/readiness";
import { isWorkerBusy, preferredModel } from "@/lib/speech/client";

export type OfflineEngine = "moonshine" | "whisper";
export type OfflineReadiness = { status: ReadinessStatus; preferredCached: boolean; ortCached: boolean };

/** Reads readiness from Cache Storage; re-checks on engine change, connectivity change and app resume. */
export function useOfflineReadiness(engine: OfflineEngine): { readiness: EngineReadiness | null; refresh: () => Promise<void> } {
  const conn = useConnectivity();
  const [readiness, setReadiness] = useState<EngineReadiness | null>(null);
  const refresh = useCallback(async () => {
    try {
      setReadiness(await engineStatus(engine));
    } catch {
      setReadiness(null);
    }
  }, [engine]);
  useEffect(() => {
    void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh(); // storage can be evicted while away
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh, conn]);
  return { readiness, refresh };
}

export function OfflineModelControl({
  engine,
  disabled,
  onStatusChange,
}: {
  engine: OfflineEngine;
  disabled: boolean;
  onStatusChange?: (r: OfflineReadiness) => void;
}) {
  const conn = useConnectivity();
  const { readiness, refresh } = useOfflineReadiness(engine);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The underlying error, shown small under the message so failures on a phone can be diagnosed. */
  const [failReason, setFailReason] = useState("");
  const [pct, setPct] = useState(0);
  const [announce, setAnnounce] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const lastTick = useRef(0);
  const lastStatus = useRef<string>("");

  const status: ReadinessStatus = downloading ? "downloading" : failed ? "error" : readiness?.status ?? "none";

  useEffect(() => {
    onStatusChange?.({
      status,
      preferredCached: readiness?.chainCached[0] ?? false,
      ortCached: readiness?.ortCached ?? false,
    });
  }, [status, readiness, onStatusChange]);

  // Announce transitions once.
  useEffect(() => {
    if (lastStatus.current === status) return;
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (status === "downloading") setAnnounce("Download started");
    else if (status === "ready" && prev === "downloading") setAnnounce("Ready offline");
    else if (status === "error") setAnnounce("Download failed");
  }, [status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    if (disabled || isWorkerBusy()) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setFailed(false);
    setFailReason("");
    setPct(0);
    setDownloading(true);
    try {
      await prefetchEngine(
        engine,
        (p) => {
          const now = Date.now();
          if (p < 100 && now - lastTick.current < 250) return; // at most every 250 ms
          lastTick.current = now;
          setPct(p);
        },
        ctl.signal
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setFailed(true);
        setFailReason(String((err as { message?: string })?.message ?? err).slice(0, 200));
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
      await refresh();
    }
  }

  const chain = chainFor(engine, preferredModel(engine));
  const size = labelSize(totalSizeMb(chain));
  const subtitle = engine === "whisper" ? `Whisper Base + speaker model, ${size}` : `Moonshine${chain.length > 1 ? " + backup model" : ""} + speaker model, ${size}`;
  const offline = conn === "offline";

  const speakerMissing = !downloading && needsSpeakerDownload({ status, speakerCached: readiness?.speakerCached ?? true });

  let badge: React.ReactNode;
  if (status === "ready") badge = <Badge tone="success"><Check className="w-3 h-3" aria-hidden />Ready offline</Badge>;
  else if (status === "downloading") badge = <Badge tone="accent">Downloading {pct}%</Badge>;
  else if (status === "error") badge = <Badge tone="live">Download failed</Badge>;
  else badge = <Badge tone="neutral">Not downloaded</Badge>;

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ui font-semibold">Offline use</h3>
        <span aria-live="off">{badge}</span>
      </div>
      <p className="mt-1 text-meta text-muted-foreground">{subtitle}</p>

      {status === "downloading" && (
        <div
          role="progressbar"
          aria-label="Offline model download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-3 h-1 w-full rounded-full bg-muted"
        >
          <div className="h-1 rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {status === "ready" && !speakerMissing && <p className="text-meta text-muted-foreground">Works with no internet.</p>}

        {status === "ready" && speakerMissing && (
          <>
            <p className="text-meta text-muted-foreground">Speaker labels need the speaker model. Download it to label speakers offline.</p>
            <Button variant="secondary" icon={<Download className="w-4 h-4" aria-hidden />} onClick={start} disabled={disabled || offline}>
              Download for offline
            </Button>
          </>
        )}

        {status === "downloading" && (
          <>
            <p className="text-meta text-muted-foreground">Keep this screen open until it finishes.</p>
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancel download
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <p role="alert" className="text-meta text-danger">
              Couldn&apos;t finish the download. Check your connection and try again.
            </p>
            {failReason && <p className="text-meta text-muted-foreground break-words">Details: {failReason}</p>}
            <Button variant="secondary" onClick={start} disabled={disabled || offline}>
              Try again
            </Button>
          </>
        )}

        {(status === "none" || status === "partial") && (
          <>
            <p className="text-meta text-muted-foreground">
              {offline
                ? NOT_READY_OFFLINE
                : status === "partial"
                  ? "Download paused. Resuming skips what is already saved."
                  : `Download once to record with no internet. Uses ${size}. Wi-Fi recommended.`}
            </p>
            <Button variant="secondary" icon={<Download className="w-4 h-4" aria-hidden />} onClick={start} disabled={disabled || offline}>
              Download for offline
            </Button>
          </>
        )}
      </div>

      <span role="status" className="sr-only">
        {announce}
      </span>
    </Panel>
  );
}
