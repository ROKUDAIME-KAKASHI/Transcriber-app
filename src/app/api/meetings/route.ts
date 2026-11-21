import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  MEETING_ID_RE,
  MEETING_LIST_SELECT,
  MEETING_LIST_SELECT_LEGACY,
  clampClientTime,
  isMissingColumn,
  withLegacyFallback,
} from "@/lib/meetingSelect";

const dbDown = (err: unknown) => {
  console.error("Meetings DB error:", err);
  return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
};

const SinceParam = z.string().datetime({ offset: true });

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const sinceRaw = new URL(req.url).searchParams.get("since");
  let since: string | undefined;
  if (sinceRaw !== null) {
    const p = SinceParam.safeParse(sinceRaw);
    if (!p.success) return Response.json({ error: "Invalid since" }, { status: 400 });
    since = p.data;
  }

  try {
    // Captured before querying so rows changing mid-query are re-sent next time, never missed.
    const serverTime = new Date();
    const meetings = await withLegacyFallback((legacy) =>
      prisma.meeting.findMany({
        where: { userId, ...(since ? { updatedAt: { gt: new Date(since) } } : {}) },
        orderBy: { createdAt: "desc" },
        select: legacy ? MEETING_LIST_SELECT_LEGACY : MEETING_LIST_SELECT,
      }),
    );
    const idRows = await prisma.meeting.findMany({ where: { userId }, select: { id: true } });
    return Response.json(
      { meetings, ids: idRows.map((r) => r.id), serverTime: serverTime.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return dbDown(err);
  }
}

const CreateBody = z.object({
  id: z.string().regex(MEETING_ID_RE).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  language: z.string().max(10).default("en"),
  deviceName: z.string().max(60).optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  engine: z.enum(["deepgram", "moonshine", "whisper"]).optional(),
});

/** Called when a device starts recording, so the meeting exists (and autosaves) from second one. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { id, title, language, deviceName, createdAt, engine } = parsed.data;
  const baseData = {
    ...(id ? { id } : {}),
    userId,
    title: title ?? `Meeting – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
    language,
    deviceName,
    ...(id && createdAt ? { createdAt: clampClientTime(createdAt) } : {}),
  };
  const create = (withEngine: boolean) =>
    prisma.meeting.create({
      data: { ...baseData, ...(withEngine && engine ? { engine } : {}) },
      select: { id: true, title: true },
    });

  try {
    let meeting;
    try {
      meeting = await create(true);
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      console.warn("Schema not pushed yet; using legacy columns");
      meeting = await create(false);
    }
    return Response.json({ meeting, savedParts: 0 }, { status: 201 });
  } catch (err) {
    if (id && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      try {
        const existing = await prisma.meeting.findUnique({
          where: { id },
          select: { id: true, title: true, userId: true, transcript: true },
        });
        if (!existing || existing.userId !== userId) {
          return Response.json({ error: "Id in use" }, { status: 409 });
        }
        const savedParts = Array.isArray(existing.transcript) ? existing.transcript.length : 0;
        return Response.json({ meeting: { id: existing.id, title: existing.title }, savedParts });
      } catch (err2) {
        return dbDown(err2);
      }
    }
    return dbDown(err);
  }
}
