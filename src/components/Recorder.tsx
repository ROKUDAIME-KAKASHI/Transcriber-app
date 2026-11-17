"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Square, MessagesSquare, Cloud, CloudOff, Loader2, ArrowRight, PlayCircle, MicOff } from "lucide-react";
import { useRecorder } from "@/hooks/useRecorder";
import { formatDuration } from "@/lib/transcript";
import { TranscriptView } from "./TranscriptView";

const MIC_KEY = "transcriber.micId";

/** Lists microphones. Names only appear after the user has allowed mic access once. */
function useMicrophones() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "")))
        .catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  return { mics, refresh: () => navigator.mediaDevices?.enumerateDevices().then((all) => setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId !== ""))) };
}

function LevelMeter({ level }: { level: number }) {
  const bars = 12;
  const lit = Math.round(level * bars);
  return (
    <div className="flex items-end gap-0.5 h-4" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-1 rounded-sm transition-colors ${i < lit ? (i >= bars - 2 ? "bg-danger" : "bg-accent") : "bg-muted"}`}
          style={{ height: `${30 + (i / (bars - 1)) * 70}%` }}
        />
      ))}
    </div>
  );
}

export function Recorder() {
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [canCaptureSystem, setCanCaptureSystem] = useState(false);
  const [micId, setMicId] = useState("");
  const { mics, refresh: refreshMics } = useMicrophones();
  const rec = useRecorder({ captureSystemAudio, deviceId: micId });
  const bottomRef = useRef<HTMLDivElement>(null);

  // getDisplayMedia (tab/system audio) is desktop-only.
  useEffect(() => {
    setCanCaptureSystem(!!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent));
    try {
      setMicId(localStorage.getItem(MIC_KEY) ?? "");
    } catch {
      /* storage blocked — keep the defaults */
    }
  }, []);

  // Device names become available once mic permission is granted, i.e. after recording starts.
  useEffect(() => {
    if (rec.isRecording) refreshMics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.isRecording]);

  const chooseMic = (id: string) => {
    setMicId(id);
    try {
      localStorage.setItem(MIC_KEY, id);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (rec.isRecording) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rec.transcriptParts, rec.interimText, rec.liveStatus, rec.isRecording]);

  const hasTranscript = rec.transcriptParts.length > 0;
  const hasLive = !!rec.interimText || !!rec.liveStatus;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center gap-4 text-center">
        <button
          onClick={rec.isRecording ? rec.stop : () => rec.start("mic")}
          className={`w-24 h-24 rounded-full grid place-items-center shadow-lg transition-transform active:scale-95 ${
            rec.isRecording ? "bg-danger text-white" : "bg-accent text-accent-foreground"
          }`}
          aria-label={rec.isRecording ? "Stop recording" : "Start recording"}
        >
          {rec.isRecording ? <Square className="w-9 h-9 fill-current" /> : <Mic className="w-10 h-10" />}
        </button>

        {!rec.isRecording && (
          <button
            onClick={() => rec.start("sample")}
            className="-mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <PlayCircle className="w-4 h-4" /> No mic? Try with sample audio
          </button>
        )}

        <div className="min-h-[3rem]">
          {rec.isRecording ? (
            <div className="flex items-center justify-center gap-2 text-danger font-semibold text-xl tabular-nums">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-danger" />
              </span>
              {formatDuration(rec.recordingSeconds)}
            </div>
          ) : (
            <div className="font-semibold text-lg">Tap to record</div>
          )}
          <p className="text-sm text-muted-foreground mt-1">{rec.statusMsg}</p>
          {rec.isRecording && (
            <div className="flex items-center justify-center gap-2 mt-2 text-xs text-muted-foreground">
              <Mic className="w-3.5 h-3.5" /> <LevelMeter level={rec.micLevel} />
            </div>
          )}
        </div>

        {rec.isRecording && rec.noSound && (
          <div className="w-full max-w-sm rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-left flex gap-2">
            <MicOff className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <span>
              <strong>No sound from the microphone.</strong> Stop, pick another microphone below, and try again.
              On Windows also check Settings → System → Sound → Input, and that the mic isn&apos;t muted.
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground max-w-sm -mt-1">
          English · free · runs on this device, so your audio never leaves it.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {mics.length > 0 && (
            <select
              value={mics.some((m) => m.deviceId === micId) ? micId : ""}
              onChange={(e) => chooseMic(e.target.value)}
              disabled={rec.isRecording}
              aria-label="Microphone"
              className="bg-muted border border-border rounded-full px-4 py-2 text-sm font-medium outline-none disabled:opacity-50 max-w-[16rem] truncate"
            >
              <option value="">🎙 Default microphone</option>
              {mics
                .filter((m) => m.deviceId !== "default")
                .map((m, i) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
          )}

          {canCaptureSystem && (
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={captureSystemAudio}
                onChange={(e) => setCaptureSystemAudio(e.target.checked)}
                disabled={rec.isRecording}
                className="w-4 h-4"
              />
              Also capture tab audio (Zoom/Meet)
            </label>
          )}
        </div>

        {rec.meetingId && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {rec.saveState === "saving" && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>}
            {rec.saveState === "saved" && <><Cloud className="w-3.5 h-3.5" /> Saved to your account</>}
            {rec.saveState === "error" && <><CloudOff className="w-3.5 h-3.5 text-danger" /> Offline — will retry</>}
          </div>
        )}

        {rec.isRecording && (
          <p className="text-xs text-muted-foreground max-w-sm">
            Keep this screen open while recording. Phones may pause the microphone if you switch apps.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 min-h-[300px]">
        {!hasTranscript && !hasLive ? (
          <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground text-center gap-2">
            <MessagesSquare className="w-12 h-12 opacity-40" />
            <p className="text-sm max-w-xs">
              The conversation appears here as a live chat while you record. Everything is saved to your account as you go.
            </p>
          </div>
        ) : (
          <TranscriptView
            parts={rec.transcriptParts}
            interimText={rec.interimText}
            liveStatus={rec.liveStatus}
            backlog={rec.backlog}
          />
        )}
        {/* scroll margin keeps the newest line clear of the phone tab bar when auto-scrolling */}
        <div ref={bottomRef} className="scroll-mb-28 sm:scroll-mb-6" />
      </section>

      {!rec.isRecording && rec.meetingId && hasTranscript && (
        <Link
          href={`/meetings/${rec.meetingId}`}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent text-accent-foreground py-3 font-semibold"
        >
          Open meeting — create minutes & export <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
