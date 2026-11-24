// Pure aggregation helpers for the /admin dashboard. No imports, so node:test can load them.

/**
 * Deepgram Nova-3 pay-as-you-go price per audio minute (USD). This is an estimate for the
 * dashboard only; adjust it when the Deepgram pricing or the plan changes.
 */
export const DEEPGRAM_USD_PER_MIN = 0.0043;

export type EngineKind = "cloud" | "ondevice" | "unknown";

export function engineKind(engine: string | null | undefined): EngineKind {
  if (engine === "deepgram") return "cloud";
  if (engine === "moonshine" || engine === "whisper") return "ondevice";
  return "unknown";
}

export function fmtHours(sec: number): string {
  const h = sec / 3600;
  return h >= 100 ? h.toFixed(0) : h.toFixed(1);
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function estimateDeepgramUsd(cloudSec: number, perMin = DEEPGRAM_USD_PER_MIN): number {
  return (cloudSec / 60) * perMin;
}

/** One groupBy row: meetings of one user with one engine value. */
export type GroupRow = { userId: string; engine: string | null; count: number; sumSec: number; lastAt: Date | null };

export type EngineTotals = { cloudSec: number; ondeviceSec: number; unknownSec: number; meetings: number; totalSec: number };

export function engineTotals(rows: GroupRow[]): EngineTotals {
  const t: EngineTotals = { cloudSec: 0, ondeviceSec: 0, unknownSec: 0, meetings: 0, totalSec: 0 };
  for (const r of rows) {
    t.meetings += r.count;
    t.totalSec += r.sumSec;
    const k = engineKind(r.engine);
    if (k === "cloud") t.cloudSec += r.sumSec;
    else if (k === "ondevice") t.ondeviceSec += r.sumSec;
    else t.unknownSec += r.sumSec;
  }
  return t;
}

export type UserStat = {
  id: string;
  email: string;
  joinedAt: Date;
  meetings: number;
  totalSec: number;
  cloudSec: number;
  lastAt: Date | null;
};

/** Merge per-(user, engine) groups into one row per user, most recently active first. */
export function foldUsers(rows: GroupRow[], users: { id: string; email: string; createdAt: Date }[]): UserStat[] {
  const byId = new Map<string, UserStat>();
  for (const u of users) {
    byId.set(u.id, { id: u.id, email: u.email, joinedAt: u.createdAt, meetings: 0, totalSec: 0, cloudSec: 0, lastAt: null });
  }
  for (const r of rows) {
    const u = byId.get(r.userId);
    if (!u) continue;
    u.meetings += r.count;
    u.totalSec += r.sumSec;
    if (engineKind(r.engine) === "cloud") u.cloudSec += r.sumSec;
    if (r.lastAt && (!u.lastAt || r.lastAt > u.lastAt)) u.lastAt = r.lastAt;
  }
  return [...byId.values()].sort((a, b) => {
    const at = a.lastAt?.getTime() ?? -1;
    const bt = b.lastAt?.getTime() ?? -1;
    return bt - at || a.email.localeCompare(b.email);
  });
}

export type DayPoint = { day: string; meetings: number; sec: number; cloudSec: number };

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** One point per UTC day for the last `days` days ending today (oldest first), zero-filled. */
export function dailySeries(
  rows: { createdAt: Date; durationSec: number; engine?: string | null }[],
  days: number,
  now: Date = new Date(),
): DayPoint[] {
  const points: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const p = { day: dayKey(new Date(end - i * 86_400_000)), meetings: 0, sec: 0, cloudSec: 0 };
    points.push(p);
    index.set(p.day, p);
  }
  for (const r of rows) {
    const p = index.get(dayKey(r.createdAt));
    if (!p) continue;
    p.meetings += 1;
    p.sec += r.durationSec;
    if (engineKind(r.engine) === "cloud") p.cloudSec += r.durationSec;
  }
  return points;
}

/** Totals over the trailing window (meetings created at or after `since`). */
export function windowTotals(rows: { createdAt: Date; durationSec: number }[], since: Date): { meetings: number; sec: number } {
  let meetings = 0;
  let sec = 0;
  for (const r of rows) {
    if (r.createdAt >= since) {
      meetings += 1;
      sec += r.durationSec;
    }
  }
  return { meetings, sec };
}
