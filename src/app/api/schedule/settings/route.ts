import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  DEFAULT_AVAILABILITY, DURATIONS, EVENT_SLUG_RE, isValidRange, isValidTimeZone, normalizeAvailability, validateHandle,
} from "@/lib/scheduling";
import { NO_STORE, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

const DEFAULT_EVENT = { slug: "30min", title: "30 min meeting", durationMin: 30, bufferMin: 0, minNoticeMin: 120, maxDaysAhead: 30, active: true, description: null };
const MAX_EVENT_TYPES = 10;

/** The host's booking handle, time zone, weekly availability and event types (defaults when nothing is saved yet). */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const [user, availability, eventTypes] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { bookingSlug: true, timeZone: true } }),
      prisma.availability.findMany({ where: { userId }, orderBy: [{ weekday: "asc" }, { startMin: "asc" }], select: { weekday: true, startMin: true, endMin: true } }),
      prisma.eventType.findMany({
        where: { userId }, orderBy: { createdAt: "asc" },
        select: { id: true, slug: true, title: true, durationMin: true, bufferMin: true, minNoticeMin: true, maxDaysAhead: true, active: true, description: true },
      }),
    ]);
    const saved = Boolean(user?.bookingSlug) || availability.length > 0 || eventTypes.length > 0;
    return Response.json(
      {
        handle: user?.bookingSlug ?? null,
        timeZone: user?.timeZone ?? null,
        availability: saved ? availability : DEFAULT_AVAILABILITY,
        eventTypes: eventTypes.length ? eventTypes : [{ id: null, ...DEFAULT_EVENT }],
        saved,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Schedule settings error:", err);
    return Response.json({ error: "Couldn't load your schedule. Try again." }, { status: 503, headers: NO_STORE });
  }
}

const EventTypeBody = z.object({
  id: z.string().max(40).nullable().optional(),
  slug: z.string().trim().toLowerCase().regex(EVENT_SLUG_RE, "Link ending must be 2 to 30 letters, numbers or hyphens."),
  title: z.string().trim().min(1, "Give each event a title.").max(80),
  durationMin: z.number().int().refine((n) => (DURATIONS as readonly number[]).includes(n), "Pick 15, 30, 45 or 60 minutes."),
  bufferMin: z.number().int().min(0).max(120),
  minNoticeMin: z.number().int().min(0).max(60 * 24 * 14),
  maxDaysAhead: z.number().int().min(1).max(180),
  active: z.boolean(),
  description: z.string().trim().max(500).nullable().optional(),
});

const Body = z.object({
  handle: z.string().max(60),
  timeZone: z.string().max(64),
  availability: z
    .array(z.object({ weekday: z.number().int(), startMin: z.number().int(), endMin: z.number().int() }))
    .max(7 * 8),
  eventTypes: z.array(EventTypeBody).min(1).max(MAX_EVENT_TYPES),
});

export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const b = parsed.data;
  const handle = validateHandle(b.handle);
  if (!handle.ok) return Response.json({ error: handle.error }, { status: 400, headers: NO_STORE });
  if (!isValidTimeZone(b.timeZone)) return Response.json({ error: "Pick a valid time zone." }, { status: 400, headers: NO_STORE });
  if (!b.availability.every(isValidRange)) {
    return Response.json({ error: "Each time range must end after it starts." }, { status: 400, headers: NO_STORE });
  }
  const slugs = b.eventTypes.map((e) => e.slug);
  if (new Set(slugs).size !== slugs.length) {
    return Response.json({ error: "Two events share the same link ending." }, { status: 400, headers: NO_STORE });
  }
  const availability = normalizeAvailability(b.availability);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { bookingSlug: handle.handle, timeZone: b.timeZone }, select: { id: true } });
      await tx.availability.deleteMany({ where: { userId } });
      if (availability.length) await tx.availability.createMany({ data: availability.map((r) => ({ ...r, userId })) });
      const existing = await tx.eventType.findMany({ where: { userId }, select: { id: true, slug: true } });
      const owned = new Set(existing.map((e) => e.id));
      // Moving slugs around could trip the unique index mid-way, so park changed slugs first.
      for (const e of b.eventTypes) {
        if (e.id && owned.has(e.id)) {
          await tx.eventType.update({ where: { id: e.id }, data: { slug: `tmp-${e.id}` }, select: { id: true } });
        }
      }
      for (const e of b.eventTypes) {
        const data = {
          slug: e.slug, title: e.title, durationMin: e.durationMin, bufferMin: e.bufferMin, minNoticeMin: e.minNoticeMin,
          maxDaysAhead: e.maxDaysAhead, active: e.active, description: e.description?.trim() || null,
        };
        if (e.id && owned.has(e.id)) await tx.eventType.update({ where: { id: e.id }, data, select: { id: true } });
        else await tx.eventType.create({ data: { ...data, userId }, select: { id: true } });
      }
      // Events missing from the list are switched off, never deleted, so existing bookings keep their event.
      const keep = new Set(b.eventTypes.map((e) => e.id).filter(Boolean) as string[]);
      const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      if (drop.length) await tx.eventType.updateMany({ where: { id: { in: drop } }, data: { active: false } });
    });
    return Response.json({ ok: true, handle: handle.handle }, { headers: NO_STORE });
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
      return Response.json(
        { error: target.includes("slug") && !target.includes("bookingSlug") ? "Two events share the same link ending." : "That handle is taken. Pick another." },
        { status: 409, headers: NO_STORE }
      );
    }
    console.error("Schedule save error:", err);
    return Response.json({ error: "Couldn't save your schedule. Try again." }, { status: 503, headers: NO_STORE });
  }
}
