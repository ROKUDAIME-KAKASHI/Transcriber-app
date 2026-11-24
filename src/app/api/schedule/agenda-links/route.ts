import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { MAX_AGENDA_CHARS } from "@/lib/followUpAgenda";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { NO_STORE, isSchedulingMissing, schedulingMissing } from "@/lib/schedulingDb";

export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().trim().min(1).max(MAX_AGENDA_CHARS),
  followUpFromMeetingId: z.string().max(60).nullable().optional(),
});
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

/** Save an agenda so a booking link can carry it. Returns the short id for `?agenda=<id>`. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  if (limiter.blocked(userId)) return Response.json({ error: "Too many links. Try again later." }, { status: 429, headers: NO_STORE });
  limiter.fail(userId);

  try {
    // Only the caller's own meeting id is kept.
    let meetingId: string | null = null;
    if (body.data.followUpFromMeetingId) {
      const m = await prisma.meeting.findFirst({ where: { id: body.data.followUpFromMeetingId, userId }, select: { id: true } });
      meetingId = m?.id ?? null;
    }
    const [row, info] = await Promise.all([
      prisma.agendaDraft.create({ data: { id: randomBytes(18).toString("base64url"), userId, text: body.data.text, followUpFromMeetingId: meetingId }, select: { id: true } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { bookingSlug: true, eventTypes: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1, select: { slug: true } } },
      }),
    ]);
    // Old drafts are not needed once their bookings exist; keep the table small.
    void prisma.agendaDraft
      .deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } })
      .catch(() => undefined);
    return Response.json(
      { id: row.id, handle: info?.bookingSlug ?? null, slug: info?.eventTypes[0]?.slug ?? null },
      { headers: NO_STORE }
    );
  } catch (err) {
    if (isSchedulingMissing(err)) return schedulingMissing();
    console.error("Agenda link error:", err);
    return Response.json({ error: "Couldn't create the link. Try again." }, { status: 503, headers: NO_STORE });
  }
}
