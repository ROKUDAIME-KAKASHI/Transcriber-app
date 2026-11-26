"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { LATEST_APK } from "@/lib/appRelease";
import type { ApkRelease } from "@/lib/appVersion";
import { getInstalledVersionCode, getLatestApk, isUpdateAvailable, isUpdateDismissed, rememberUpdateDismissed, startApkUpdate } from "@/lib/appUpdate";
import { isRecordingActive } from "@/lib/recordingFlag";

/** Native app only: offers the newest APK when the installed versionCode is older. */
export function AppUpdateBanner() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [release, setRelease] = useState<ApkRelease>(LATEST_APK);

  const check = useCallback(async () => {
    const installed = await getInstalledVersionCode();
    if (installed === null) return setShow(false); // website: nothing to update, no fetch
    const { release: latest } = await getLatestApk();
    setRelease(latest);
    if (!isUpdateAvailable(installed, latest.versionCode) || isUpdateDismissed(latest.versionCode)) return setShow(false);
    setShow(!(await isRecordingActive()));
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => clearInterval(t);
  }, [check]);

  if (!show) return null;

  const update = async () => {
    const r = await startApkUpdate(release);
    if (r === "copied") toast("Link copied. Open it in Chrome.", "neutral");
    else if (r === "failed") toast("Couldn't open the link. Try again.", "danger");
  };
  const dismiss = () => {
    rememberUpdateDismissed(release.versionCode);
    setShow(false);
  };

  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-chip border border-accent/30 bg-accent-soft px-4 py-3 text-ui">
      <Download className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">A new version of the app is available</p>
        <p className="mt-0.5 text-meta text-muted-foreground">
          {release.versionName}: {release.notes}
        </p>
        <p className="mt-1 text-meta text-muted-foreground">
          Android may ask you to allow installs from your browser. Installing over the current app keeps your meetings.
        </p>
        <div className="mt-2">
          <Button variant="primary" className="min-h-11" onClick={update}>
            Update
          </Button>
        </div>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss update notice"
        className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
