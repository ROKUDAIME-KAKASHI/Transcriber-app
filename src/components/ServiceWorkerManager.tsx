"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UpdateNotice, type UpdateNoticeMode } from "@/components/UpdateNotice";
import { isRecordingActive } from "@/lib/recordingFlag";
import { applyUpdate, checkForUpdate, registerServiceWorker, warmLazy, watchForUpdate } from "@/lib/sw/register";
import { isChunkLoadError, shouldReloadForChunkError } from "@/lib/sw/updateCore";

const LAST_RELOAD_KEY = "sw.chunkReloadAt";

export function ServiceWorkerManager() {
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [chunkError, setChunkError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [recording, setRecording] = useState(false);

  const refreshRecording = useCallback(() => {
    isRecordingActive().then(setRecording, () => setRecording(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    registerServiceWorker().then((reg) => {
      if (cancelled || !reg) return;
      regRef.current = reg;
      watchForUpdate(reg, () => {
        setDismissed(false);
        setWaiting(true);
        refreshRecording();
      });
      if (navigator.serviceWorker.controller) warmLazy();
      else navigator.serviceWorker.ready.then(() => warmLazy()).catch(() => {});
    });

    const onChunk = async (err: unknown) => {
      if (!isChunkLoadError(err)) return;
      const rec = await isRecordingActive().catch(() => true);
      let last: number | null = null;
      try {
        const v = sessionStorage.getItem(LAST_RELOAD_KEY);
        last = v ? Number(v) : null;
      } catch {
        /* ignore */
      }
      const d = shouldReloadForChunkError({ recording: rec, lastReloadAt: last, now: Date.now() });
      if (d.action === "reload") {
        try {
          sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
        window.location.reload();
      } else if (d.action === "notice") {
        setRecording(true);
        setDismissed(false);
        setChunkError(true);
      }
    };
    const onError = (e: ErrorEvent) => void onChunk(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => void onChunk(e.reason);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (regRef.current) checkForUpdate(regRef.current);
        refreshRecording();
      }
    };
    const onOnline = () => {
      if (regRef.current) checkForUpdate(regRef.current);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshRecording]);

  // Re-evaluate the recording flag while a notice is visible.
  const visible = (waiting || chunkError) && !dismissed;
  useEffect(() => {
    if (!visible) return;
    refreshRecording();
    const t = setInterval(refreshRecording, 3000);
    return () => clearInterval(t);
  }, [visible, refreshRecording]);

  const onReload = useCallback(async () => {
    if (await isRecordingActive().catch(() => true)) {
      setRecording(true);
      return;
    }
    if (chunkError) {
      window.location.reload();
      return;
    }
    if (regRef.current) applyUpdate(regRef.current);
  }, [chunkError]);

  if (!visible) return null;
  const mode: UpdateNoticeMode = chunkError && recording ? "chunk-error" : recording ? "ready-recording" : "ready";
  return <UpdateNotice mode={mode} onReload={onReload} onDismiss={() => setDismissed(true)} />;
}
