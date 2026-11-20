import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";

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
    const meeting = await prisma.meeting.findFirst({ where: { id, userId } });
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
});

/** Autosave target while recording, and rename afterwards. */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { transcriptTail, ...data } = parsed.data;
  try {
    if (transcriptTail) {
      const existing = await prisma.meeting.findFirst({ where: { id, userId }, select: { transcript: true } });
      if (!existing) return notFound();
      const current = Array.isArray(existing.transcript) ? existing.transcript : [];
      // The client thinks more is saved than really is (a save got lost): tell it where to resend from.
      if (transcriptTail.from > current.length) {
        return Response.json({ error: "Transcript out of sync", savedParts: current.length }, { status: 409 });
      }
      const merged = [...current.slice(0, transcriptTail.from), ...transcriptTail.parts];
      if (merged.length > MAX_PARTS) return Response.json({ error: "Transcript too long" }, { status: 413 });
      await prisma.meeting.updateMany({ where: { id, userId }, data: { ...data, transcript: merged } });
      return Response.json({ ok: true, savedParts: merged.length });
    }
    // updateMany scoped by userId so nobody can write to another account's meeting.
    const { count } = await prisma.meeting.updateMany({ where: { id, userId }, data });
    return count ? Response.json({ ok: true, savedParts: data.transcript?.length }) : notFound();
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
