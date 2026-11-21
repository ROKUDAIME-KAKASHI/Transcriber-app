import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  MEETING_FULL_SELECT,
  MEETING_FULL_SELECT_LEGACY,
  clampClientTime,
  withLegacyFallback,
} from "@/lib/meetingSelect";

type Ctx = { params: Promise<{ id: string }> };

const dbDown = (err: unknown) => {
  console.error("Meeting DB error:", err);
  return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
};

const notFound = () => Response.json({ error: "Meeting not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  try {
    const meeting = await withLegacyFallback((legacy) =>
      prisma.meeting.findFirst({
        where: { id, userId },
        select: legacy ? MEETING_FULL_SELECT_LEGACY : MEETING_FULL_SELECT,
      }),
    );
    return meeting ? Response.json({ meeting }) : notFound();
  } catch (err) {
    return dbDown(err);
  }
}

const Part = z.object({ speaker: z.number().int().min(0), text: z.string().max(5000), t: z.number().min(0).optional() });
/** Enough for 24 h of phrases every ~1.5 s. */
const MAX_PARTS = 60_000;

const PatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** The whole transcript (small meetings, older clients). */
  transcript: z.array(Part).max(MAX_PARTS).optional(),
  /**
   * Incremental autosave for long meetings: replace everything from index `from` onwards with
   * `parts`. A 10-hour meeting is ~1 MB of text; re-sending all of it every 5 s on mobile data
   * doesn't scale, so the recorder only sends what changed since its last confirmed save.
   */
  transcriptTail: z.object({ from: z.number().int().min(0), parts: z.array(Part).max(MAX_PARTS) }).optional(),
  durationSec: z.number().int().min(0).optional(),
  status: z.enum(["RECORDING", "DONE"]).optional(),
  /** Client clock of the title edit; the newer edit wins. */
  titleUpdatedAt: z.string().datetime({ offset: true }).optional(),
  engine: z.enum(["deepgram", "moonshine", "whisper"]).optional(),
  speakerNames: z
    .record(z.string().regex(/^\d{1,2}$/), z.string().trim().max(60))
    .refine((r) => Object.keys(r).length <= 50, "Too many speakers")
    .optional(),
});

/** Autosave target while recording, and rename afterwards. */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { transcriptTail, title, titleUpdatedAt, engine, speakerNames, ...rest } = parsed.data;

  const apply = async (legacy: boolean): Promise<Response> => {
    const extra = legacy ? {} : { ...(engine ? { engine } : {}), ...(speakerNames ? { speakerNames } : {}) };
    const data = { ...rest, ...extra, updatedAt: new Date() };
    let savedParts: number | undefined;

    if (transcriptTail) {
      // Optimistic concurrency: write only if the row is unchanged since we read it (updatedAt),
      // otherwise re-read and recompute, so a concurrent writer's parts are never silently dropped.
      let done = false;
      for (let tries = 0; tries < 4 && !done; tries++) {
        const existing = await prisma.meeting.findFirst({
          where: { id, userId },
          select: { transcript: true, updatedAt: true },
        });
        if (!existing) return notFound();
        const current = Array.isArray(existing.transcript) ? existing.transcript : [];
        // The client thinks more is saved than really is (a save got lost): tell it where to resend from.
        if (transcriptTail.from > current.length) {
          return Response.json({ error: "Transcript out of sync", savedParts: current.length }, { status: 409 });
        }
        const merged = [...current.slice(0, transcriptTail.from), ...transcriptTail.parts];
        if (merged.length > MAX_PARTS) return Response.json({ error: "Transcript too long" }, { status: 413 });
        const { count } = await prisma.meeting.updateMany({
          where: { id, userId, updatedAt: existing.updatedAt },
          data: { ...data, transcript: merged },
        });
        if (count) {
          savedParts = merged.length;
          done = true;
        }
      }
      if (!done) {
        return Response.json({ error: "Meeting was changed at the same time. Try again." }, { status: 503 });
      }
    } else {
      // updateMany scoped by userId so nobody can write to another account's meeting.
      const { count } = await prisma.meeting.updateMany({ where: { id, userId }, data });
      if (!count) return notFound();
      savedParts = rest.transcript?.length;
    }

    let storedTitle: string | undefined;
    if (title !== undefined) {
      if (legacy) {
        await prisma.meeting.updateMany({ where: { id, userId }, data: { title, updatedAt: new Date() } });
      } else {
        const t = clampClientTime(titleUpdatedAt);
        // Atomic last-writer-wins: only a newer edit replaces the title.
        await prisma.meeting.updateMany({
          where: { id, userId, OR: [{ titleUpdatedAt: null }, { titleUpdatedAt: { lt: t } }] },
          data: { title, titleUpdatedAt: t, updatedAt: new Date() },
        });
      }
      const row = await prisma.meeting.findFirst({ where: { id, userId }, select: { title: true } });
      storedTitle = row?.title;
    }
    return Response.json({ ok: true, savedParts, ...(storedTitle !== undefined ? { title: storedTitle } : {}) });
  };

  try {
    return await withLegacyFallback(apply);
  } catch (err) {
    return dbDown(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  try {
    const { count } = await prisma.meeting.deleteMany({ where: { id, userId } });
    return count ? Response.json({ ok: true }) : notFound();
  } catch (err) {
    return dbDown(err);
  }
}
