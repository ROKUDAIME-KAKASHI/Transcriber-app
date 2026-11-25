"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Copy, Download, RefreshCw, Share2, Users } from "lucide-react";
import { Badge, Button, Panel, PanelHeader, Switch } from "@/components/ui";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { useOfflineReadiness } from "@/components/OfflineModelControl";
import { useConnectivity } from "@/lib/connectivity";
import { useMotionPref } from "@/lib/motionPref";
import { useFlag } from "@/lib/flagsClient";
import { useCalendarReady } from "@/lib/calendarClient";
import { useSignOut } from "@/hooks/useSignOut";
import { LATEST_APK } from "@/lib/appRelease";
import { getInstalledVersion, getLatestApk, isUpdateAvailable, startApkUpdate } from "@/lib/appUpdate";
import { absoluteUrl, describeInstalled, isAndroidUserAgent, type ApkRelease } from "@/lib/appVersion";
import { getShare, hasPlugin, isNative } from "@/lib/native";
import { version as webVersion } from "../../package.json";

const OFFLINE_REASON = "Needs internet.";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-1">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-ui font-medium">{children}</span>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Account ---------- */
function AccountSection({ offline }: { offline: boolean }) {
  const { user, cachedUser } = useAuth();
  const email = user?.email ?? cachedUser?.email ?? "";
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (offline) setConfirming(false);
  }, [offline]);
  return (
    <Panel aria-label="Account">
      <PanelHeader title="Account" />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-ui font-semibold uppercase text-accent">
            {email.slice(0, 1) || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-ui font-semibold" title={email}>
              {email || "Signed in"}
            </p>
            {offline && <p className="text-meta text-muted-foreground">Offline. Showing your saved account.</p>}
          </div>
        </div>
        {confirming ? (
          <div className="rounded-chip bg-muted p-3">
            <p className="text-ui font-semibold">Sign out of Minutely?</p>
            <p className="mt-0.5 text-meta text-muted-foreground">Meetings saved on this device stay here.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger-solid" onClick={signOut}>
                Sign out
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="secondary" disabled={offline} onClick={() => setConfirming(true)}>
              Sign out
            </Button>
            {offline && <p className="mt-1.5 text-meta text-muted-foreground">Signing out needs internet.</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------- Booking link ---------- */
type BookingState = { kind: "loading" } | { kind: "none" } | { kind: "handle"; handle: string } | { kind: "error" };

function BookingSection({ offline }: { offline: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<BookingState>({ kind: "loading" });
  useEffect(() => {
    if (offline) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/schedule/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const j = (await res.json()) as { handle?: string | null };
        if (alive) setState(j.handle ? { kind: "handle", handle: j.handle } : { kind: "none" });
      } catch {
        if (alive) setState({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [offline]);

  const link = state.kind === "handle" ? absoluteUrl(window.location.origin, `/book/${state.handle}`) : "";
  const copy = async () => {
    const ok = await copyText(link);
    toast(ok ? "Link copied" : "Couldn't copy. Select the link instead.", ok ? "success" : "danger");
  };
  const share = async () => {
    try {
      if (hasPlugin("Share")) {
        await (await getShare()).share({ title: "Book a meeting with me", url: link, dialogTitle: "Share booking link" });
      } else if (typeof navigator.share === "function") {
        await navigator.share({ title: "Book a meeting with me", url: link });
      } else {
        toast((await copyText(link)) ? "Link copied" : "Couldn't share the link", "neutral");
      }
    } catch {
      /* user cancelled the share sheet */
    }
  };

  return (
    <Panel aria-label="Booking link">
      <PanelHeader title="Booking link" />
      <div className="space-y-3 p-4">
        {offline ? (
          <p className="text-meta text-muted-foreground">{OFFLINE_REASON} Connect to see or share your booking link.</p>
        ) : state.kind === "loading" ? (
          <p className="text-meta text-muted-foreground">Loading…</p>
        ) : state.kind === "error" ? (
          <p className="text-meta text-muted-foreground">Couldn&apos;t load your booking link. Try again later.</p>
        ) : state.kind === "none" ? (
          <>
            <p className="text-meta text-muted-foreground">Let people book time with you from a public page.</p>
            <Link href="/schedule" className="inline-flex min-h-12 items-center rounded-btn bg-accent px-4 text-ui font-semibold text-accent-foreground lg:min-h-10">
              Set up your booking link
            </Link>
          </>
        ) : (
          <>
            <p className="break-all rounded-chip bg-muted px-3 py-2 text-ui" data-testid="booking-link">
              {link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={copy}>
                Copy
              </Button>
              <Button variant="secondary" icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={share}>
                Share
              </Button>
              <Link href="/schedule" className="inline-flex min-h-12 items-center rounded-btn px-4 text-ui font-semibold text-accent hover:bg-muted lg:min-h-10">
                Edit
              </Link>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ---------- App (version, update, install) ---------- */
function AppSection({ offline }: { offline: boolean }) {
  const toast = useToast();
  const [native, setNative] = useState(false);
  const [android, setAndroid] = useState(false);
  const [installed, setInstalled] = useState<{ code: number; name: string | null } | null>(null);
  const [release, setRelease] = useState<ApkRelease>(LATEST_APK);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState("");
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    let alive = true;
    setNative(isNative());
    setAndroid(isAndroidUserAgent(navigator.userAgent));
    setPageUrl(window.location.origin);
    void getInstalledVersion().then((v) => alive && setInstalled(v));
    void getLatestApk().then((r) => alive && setRelease(r.release));
    return () => {
      alive = false;
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    setCheckNote("");
    const r = await getLatestApk({ fresh: true });
    setRelease(r.release);
    setChecking(false);
    if (!r.fromServer) setCheckNote("Couldn't reach the server. Showing the last known version.");
    else if (isUpdateAvailable(installed?.code ?? null, r.release.versionCode)) setCheckNote("A new version is available.");
    else setCheckNote("You have the latest version.");
  }, [installed]);

  const install = async () => {
    const r = await startApkUpdate(release);
    if (r === "copied") toast("Link copied. Open it in Chrome.", "neutral");
    else if (r === "failed") toast("Couldn't open the link. Try again.", "danger");
  };

  const apkUrl = pageUrl ? absoluteUrl(pageUrl, release.url) : release.url;
  const updateAvailable = isUpdateAvailable(installed?.code ?? null, release.versionCode);

  return (
    <Panel aria-label="App">
      <PanelHeader title="App" />
      <div className="space-y-3 p-4">
        {native ? (
          <>
            <div className="divide-y divide-border/70">
              <Row label="Installed version">{installed ? describeInstalled(installed) : "Checking…"}</Row>
              <Row label="Latest version">
                {release.versionName} (build {release.versionCode})
              </Row>
              <Row label="Status">
                {installed && (updateAvailable ? <Badge tone="warning">Update available</Badge> : <Badge tone="success"><Check className="h-3 w-3" aria-hidden />Up to date</Badge>)}
              </Row>
            </div>
            {release.notes && (
              <p className="text-meta text-muted-foreground">
                <span className="font-semibold text-foreground">What&apos;s new in {release.versionName}: </span>
                {release.notes}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={offline}
                loading={checking}
                icon={<RefreshCw className="h-4 w-4" aria-hidden />}
                onClick={check}
              >
                Check for update
              </Button>
              {updateAvailable && (
                <Button variant="primary" icon={<Download className="h-4 w-4" aria-hidden />} onClick={install}>
                  Install update
                </Button>
              )}
            </div>
            {offline && <p className="text-meta text-muted-foreground">{OFFLINE_REASON} Checking and installing need a connection.</p>}
            <p role="status" className="min-h-4 text-meta text-muted-foreground">
              {checkNote}
            </p>
            <p className="text-meta text-muted-foreground">
              Android may ask you to allow installs from your browser. Installing over the current app keeps your meetings.
            </p>
            <button
              type="button"
              onClick={install}
              disabled={offline}
              className="min-h-11 rounded-btn px-1 text-ui font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
            >
              Install latest app again
            </button>
          </>
        ) : (
          <>
            <p className="text-ui font-semibold">Get the Android app</p>
            <p className="text-meta text-muted-foreground">
              Version {release.versionName}. Records with the screen locked and keeps your meetings on the phone.
            </p>
            {android ? (
              <a
                href={apkUrl}
                download
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-ui font-semibold text-accent-foreground"
              >
                <Download className="h-4 w-4" aria-hidden />
                Download
              </a>
            ) : (
              <>
                <p className="text-meta text-muted-foreground">Open this page on your Android phone to install.</p>
                <p className="break-all rounded-chip bg-muted px-3 py-2 text-ui">{apkUrl}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<Copy className="h-4 w-4" aria-hidden />}
                    onClick={async () => toast((await copyText(apkUrl)) ? "Link copied" : "Couldn't copy. Select the link instead.", "neutral")}
                  >
                    Copy link
                  </Button>
                  <a href={apkUrl} download className="inline-flex min-h-12 items-center rounded-btn px-4 text-ui font-semibold text-accent hover:bg-muted lg:min-h-10">
                    Download the file
                  </a>
                </div>
              </>
            )}
            <p className="text-meta text-muted-foreground">
              Android may ask you to allow installs from your browser.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ---------- Calendar sharing ---------- */
function CalendarSection({ offline }: { offline: boolean }) {
  const on = useFlag("calendar");
  const ready = useCalendarReady(on && !offline);
  const toast = useToast();
  const [share, setShare] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void fetch("/api/calendar/prefs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { shareFreeBusy?: boolean } | null) => {
        if (!cancelled && j) setShare(Boolean(j.shareFreeBusy));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!ready || share === null) return null;

  const change = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    const before = share;
    setShare(next);
    try {
      const r = await fetch("/api/calendar/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareFreeBusy: next }),
      });
      if (!r.ok) throw new Error(String(r.status));
      toast(next ? "Sharing when you're busy" : "Sharing turned off", "success");
    } catch {
      setShare(before);
      toast("Couldn't save this setting. Try again.", "danger");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel aria-label="Calendar">
      <PanelHeader title="Calendar" />
      <div className="p-2">
        <Switch
          label="Share when I'm busy with other Minutely users"
          description="Anyone signed in to Minutely who knows your email can see your busy times and working hours when planning a meeting. They never see titles or details."
          checked={share}
          disabled={saving || offline}
          onChange={(v) => void change(v)}
        />
      </div>
    </Panel>
  );
}

/* ---------- Preferences ---------- */
function PreferencesSection() {
  const { pref, setPref } = useMotionPref();
  return (
    <Panel aria-label="Preferences">
      <PanelHeader title="Preferences" />
      <div className="p-2">
        <Switch
          label="Reduce motion"
          description="Fewer animations. Saves a little battery."
          checked={pref === "reduced"}
          onChange={(on) => setPref(on ? "reduced" : "auto")}
        />
      </div>
    </Panel>
  );
}

/* ---------- Storage ---------- */
function StorageSection() {
  const { readiness } = useOfflineReadiness("moonshine");
  const line = !readiness
    ? "Checking…"
    : readiness.status === "ready"
      ? "Saved on this device. On-device recording works with no internet."
      : readiness.status === "partial"
        ? "Partly saved. Finish the download on the Record screen."
        : "Not saved yet. Download it once to record without internet.";
  return (
    <Panel aria-label="Storage">
      <PanelHeader title="Offline models" />
      <div className="space-y-2 p-4">
        <p className="text-ui">{line}</p>
        <Link href="/" className="inline-flex min-h-11 items-center text-ui font-semibold text-accent underline-offset-2 hover:underline">
          Open offline use on Record
        </Link>
      </div>
    </Panel>
  );
}

/* ---------- People ---------- */
function PeopleSection() {
  const on = useFlag("stakeholders");
  if (!on) return null;
  return (
    <Panel aria-label="People">
      <Link href="/people" className="flex min-h-14 items-center gap-3 rounded-panel px-4 py-3 hover:bg-muted">
        <Users className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-semibold">People</span>
          <span className="block text-meta text-muted-foreground">The people you meet, for attendees and task owners</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </Panel>
  );
}

export function ProfilePage() {
  const offline = useConnectivity() === "offline";
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <AccountSection offline={offline} />
      <PeopleSection />
      <BookingSection offline={offline} />
      <CalendarSection offline={offline} />
      <AppSection offline={offline} />
      <PreferencesSection />
      <StorageSection />
      <p className="px-1 text-meta text-muted-foreground">
        Minutely web {webVersion} · Android app {LATEST_APK.versionName} (build {LATEST_APK.versionCode})
      </p>
    </div>
  );
}
