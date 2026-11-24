import { Prisma } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { validateHandle, isValidTimeZone } from "@/lib/scheduling";

/** True when a scheduling table or column isn't in the database yet: `prisma db push` hasn't run. */
export function isSchedulingMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export const SCHEDULING_MISSING_MESSAGE = "Scheduling needs a database update";

export function schedulingMissing(): Response {
  return Response.json({ error: SCHEDULING_MISSING_MESSAGE }, { status: 503, headers: NO_STORE });
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function tokensEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface PublicEvent {
  host: { id: string; handle: string; timeZone: string };
  event: {
    id: string; slug: string; title: string; durationMin: number; bufferMin: number;
    minNoticeMin: number; maxDaysAhead: number; description: string | null;
  };
}

const EVENT_SELECT = {
  id: true, slug: true, title: true, durationMin: true, bufferMin: true,
  minNoticeMin: true, maxDaysAhead: true, description: true,
} as const;

export async function findHost(handle: string) {
  const v = validateHandle(handle);
  if (!v.ok) return null;
  const u = await prisma.user.findUnique({
    where: { bookingSlug: v.handle },
    select: { id: true, bookingSlug: true, timeZone: true },
  });
  if (!u || !u.bookingSlug) return null;
  return { id: u.id, handle: u.bookingSlug, timeZone: u.timeZone && isValidTimeZone(u.timeZone) ? u.timeZone : "UTC" };
}

export async function findPublicEvent(handle: string, slug: string): Promise<PublicEvent | null> {
  const host = await findHost(handle);
  if (!host) return null;
  const event = await prisma.eventType.findFirst({
    where: { userId: host.id, slug: slug.toLowerCase(), active: true },
    select: EVENT_SELECT,
  });
  return event ? { host, event } : null;
}

export async function listPublicEvents(handle: string) {
  const host = await findHost(handle);
  if (!host) return null;
  const events = await prisma.eventType.findMany({
    where: { userId: host.id, active: true },
    orderBy: { createdAt: "asc" },
    select: EVENT_SELECT,
  });
  return { host, events };
}

/** Only the agenda text, and only when it belongs to this host. */
export async function findAgendaFor(hostId: string, id: string | null | undefined) {
  if (!id || id.length > 40) return null;
  return prisma.agendaDraft.findFirst({
    where: { id, userId: hostId },
    select: { text: true, followUpFromMeetingId: true },
  });
}
