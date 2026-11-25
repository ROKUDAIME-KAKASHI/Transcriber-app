import type { Metadata } from "next";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { loadAdminData, type AdminData } from "@/lib/adminData";
import { loadErrorRows } from "@/lib/errorLogDb";
import { DEEPGRAM_USD_PER_MIN, engineKind, estimateDeepgramUsd, fmtDuration, fmtHours } from "@/lib/adminStats";
import { AdminErrors, AdminLogin, AdminLogout, AdminUsersTable, type ErrorRowView, type UserRowView } from "@/components/AdminClient";
import { Badge, Notice, Panel, PanelHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
  other: { robots: "noindex" },
};

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "never");
const fmtDateTime = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Admin</h1>
        {actions}
      </div>
      {children}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Panel as="div" className="p-4">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-meta text-muted-foreground tabular-nums">{sub}</p>}
    </Panel>
  );
}

function Bars({ data, value, label }: { data: AdminData["daily"]; value: (p: AdminData["daily"][number]) => number; label: (p: AdminData["daily"][number]) => string }) {
  const max = Math.max(1, ...data.map(value));
  const w = 10;
  const gap = 4;
  const h = 96;
  return (
    <svg viewBox={`0 0 ${data.length * (w + gap)} ${h}`} className="h-24 w-full min-w-[480px] text-accent" role="img" aria-label="Last 30 days">
      {data.map((p, i) => {
        const bh = (value(p) / max) * (h - 4);
        return (
          <rect key={p.day} x={i * (w + gap)} y={h - bh} width={w} height={Math.max(bh, value(p) > 0 ? 2 : 0)} rx={2} fill="currentColor">
            <title>{label(p)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default async function AdminPage() {
  if (!adminConfigured()) {
    return (
      <Shell>
        <Notice tone="warning" title="Admin is not set up">The admin password has not been configured on this deployment.</Notice>
      </Shell>
    );
  }
  if (!(await isAdminAuthed())) {
    return (
      <Shell>
        <AdminLogin />
      </Shell>
    );
  }

  const [d, errs] = await Promise.all([loadAdminData(), loadErrorRows()]);
  const errorRows: ErrorRowView[] = errs.rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    message: e.message,
    count: e.count,
    last: fmtDateTime(e.lastSeenAt),
    appVersion: e.appVersion ?? "-",
    path: e.url ? e.url.replace(/^https?:\/\/[^/]+/, "") || "/" : "-",
  }));
  const m = d.meetings;
  const cloudCost = estimateDeepgramUsd(m.cloudSec);
  const cost30 = estimateDeepgramUsd(d.daily.reduce((a, p) => a + p.cloudSec, 0));
  const userRows: UserRowView[] = d.userStats.map((u) => ({
    id: u.id,
    email: u.email,
    joined: fmtDate(u.joinedAt),
    meetings: u.meetings,
    hours: fmtHours(u.totalSec),
    cloudHours: fmtHours(u.cloudSec),
    last: fmtDate(u.lastAt),
  }));

  return (
    <Shell actions={<AdminLogout />}>
      {!d.engineAvailable && (
        <Notice tone="warning" title="Engine column missing">Schema not pushed yet, so cloud vs on-device is unknown.</Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Users" value={String(d.users)} sub={`${d.activeUsers7} active (7 d)`} />
        <Stat label="Meetings" value={String(m.meetings)} sub={`${d.withMinutes} with AI minutes`} />
        <Stat label="Recorded hours" value={fmtHours(m.totalSec)} />
        <Stat label="Last 7 days" value={`${d.last7.meetings} mtg`} sub={`${fmtHours(d.last7.sec)} h`} />
        <Stat label="Last 30 days" value={`${d.last30.meetings} mtg`} sub={`${fmtHours(d.last30.sec)} h`} />
        <Stat label="Cloud (Deepgram)" value={`${fmtHours(m.cloudSec)} h`} />
        <Stat label="On-device" value={`${fmtHours(m.ondeviceSec)} h`} />
        <Stat label="Engine unknown" value={`${fmtHours(m.unknownSec)} h`} />
      </div>

      <AdminUsersTable rows={userRows} />

      <Panel>
        <PanelHeader title="Activity, last 30 days" meta="UTC days" />
        <div className="space-y-4 p-4">
          <div className="overflow-x-auto">
            <p className="mb-1 text-meta text-muted-foreground">Meetings per day</p>
            <Bars data={d.daily} value={(p) => p.meetings} label={(p) => `${p.day}: ${p.meetings} meetings`} />
          </div>
          <div className="overflow-x-auto">
            <p className="mb-1 text-meta text-muted-foreground">Hours per day</p>
            <Bars data={d.daily} value={(p) => p.sec} label={(p) => `${p.day}: ${fmtHours(p.sec)} h`} />
          </div>
          <p className="text-meta text-muted-foreground tabular-nums">
            Estimated Deepgram cost: ${cost30.toFixed(2)} last 30 days, ${cloudCost.toFixed(2)} all time
            (at ${DEEPGRAM_USD_PER_MIN}/min, adjust in src/lib/adminStats.ts).
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Recent meetings" meta="last 50" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-meta">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/70">
                {["Date (UTC)", "User", "Duration", "Engine", "Status"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {d.recent.map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2">{r.email}</td>
                  <td className="whitespace-nowrap px-4 py-2">{fmtDuration(r.durationSec)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={engineKind(r.engine) === "cloud" ? "accent" : "neutral"}>{r.engine ?? "unknown"}</Badge>
                  </td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <AdminErrors rows={errorRows} available={errs.available} />
    </Shell>
  );
}
