import { prisma } from "./prisma";
import { isMissingColumn } from "./meetingSelect";
import {
  dailySeries,
  engineTotals,
  foldUsers,
  windowTotals,
  type DayPoint,
  type EngineTotals,
  type GroupRow,
  type UserStat,
} from "./adminStats";

const DAY = 86_400_000;

export type RecentMeeting = {
  id: string;
  createdAt: Date;
  email: string;
  durationSec: number;
  engine: string | null;
  status: string;
};

export type AdminData = {
  users: number;
  meetings: EngineTotals;
  last7: { meetings: number; sec: number };
  last30: { meetings: number; sec: number };
  withMinutes: number;
  activeUsers7: number;
  userStats: UserStat[];
  daily: DayPoint[];
  recent: RecentMeeting[];
  engineAvailable: boolean;
};

/** Aggregates only: never selects transcript, document, titles or speaker names. */
async function load(legacy: boolean): Promise<AdminData> {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);

  const [users, groups, withMinutes, windowRows, recent] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, createdAt: true } }),
    legacy
      ? prisma.meeting.groupBy({ by: ["userId"], _count: { _all: true }, _sum: { durationSec: true }, _max: { createdAt: true } })
      : prisma.meeting.groupBy({ by: ["userId", "engine"], _count: { _all: true }, _sum: { durationSec: true }, _max: { createdAt: true } }),
    prisma.meeting.count({ where: { document: { not: null } } }),
    legacy
      ? prisma.meeting.findMany({ where: { createdAt: { gte: since30 } }, select: { userId: true, createdAt: true, durationSec: true } })
      : prisma.meeting.findMany({ where: { createdAt: { gte: since30 } }, select: { userId: true, createdAt: true, durationSec: true, engine: true } }),
    legacy
      ? prisma.meeting.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, status: true, durationSec: true, createdAt: true, user: { select: { email: true } } },
        })
      : prisma.meeting.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, status: true, durationSec: true, engine: true, createdAt: true, user: { select: { email: true } } },
        }),
  ]);

  const rows: GroupRow[] = groups.map((g) => ({
    userId: g.userId,
    engine: "engine" in g ? ((g as { engine: string | null }).engine ?? null) : null,
    count: g._count._all,
    sumSec: g._sum.durationSec ?? 0,
    lastAt: g._max.createdAt ?? null,
  }));
  const wr = windowRows as { userId: string; createdAt: Date; durationSec: number; engine?: string | null }[];

  return {
    users: users.length,
    meetings: engineTotals(rows),
    last7: windowTotals(wr, since7),
    last30: windowTotals(wr, since30),
    withMinutes,
    activeUsers7: new Set(wr.filter((r) => r.createdAt >= since7).map((r) => r.userId)).size,
    userStats: foldUsers(rows, users),
    daily: dailySeries(wr, 30, now),
    recent: (recent as unknown as {
      id: string; status: string; durationSec: number; engine?: string | null; createdAt: Date; user: { email: string };
    }[]).map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      email: m.user.email,
      durationSec: m.durationSec,
      engine: m.engine ?? null,
      status: m.status,
    })),
    engineAvailable: !legacy,
  };
}

export async function loadAdminData(): Promise<AdminData> {
  try {
    return await load(false);
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    return load(true);
  }
}
