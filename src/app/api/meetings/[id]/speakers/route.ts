import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { isMissingColumn } from "@/lib/meetingSelect";

type Ctx = { params: Promise<{ id: string }> };

const dbDown = (err: unknown) => {
  console.error("Speakers DB error:", err);
  return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
};

const SpeakerNames = z
  .record(z.string().regex(/^\d{1,2}$/), z.string().trim().max(60))
  .refine((r) => Object.keys(r).length <= 50, "Too many speakers");

const Body = z
  .object({
    relabel: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })).max(50).optional(),
    parts: z.array(z.object({ index: z.number().int().min(0), speaker: z.number().int().min(0) })).max(60_000).optional(),
    speakerNames: SpeakerNames.optional(),
  })
  .refine((b) => b.relabel || b.parts || b.speakerNames, "Nothing to change");

/** Rename speakers / merge or swap labels / fix single phrases. Idempotent. */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { relabel, parts, speakerNames } = parsed.data;

  try {
    // Optimistic concurrency on updatedAt: retry if a tail PATCH landed between our read and write.
    let nextLen = -1;
    for (let tries = 0; tries < 4 && nextLen < 0; tries++) {
      const existing = await prisma.meeting.findFirst({
        where: { id, userId },
        select: { transcript: true, updatedAt: true },
      });
      if (!existing) return Response.json({ error: "Meeting not found" }, { status: 404 });

      const current = Array.isArray(existing.transcript) ? (existing.transcript as Record<string, unknown>[]) : [];
      const map = new Map<number, number>();
      for (const r of relabel ?? []) map.set(r.from, r.to);
      // One simultaneous pass, so {0->1, 1->0} swaps instead of collapsing.
      const next = current.map((p) =>
        typeof p.speaker === "number" && map.has(p.speaker) ? { ...p, speaker: map.get(p.speaker)! } : p,
      );
      for (const o of parts ?? []) {
        if (o.index < next.length) next[o.index] = { ...next[o.index], speaker: o.speaker };
      }

      const write = (withNames: boolean) =>
        prisma.meeting.updateMany({
          where: { id, userId, updatedAt: existing.updatedAt },
          data: {
            transcript: next as unknown as object[],
            ...(withNames && speakerNames ? { speakerNames } : {}),
            updatedAt: new Date(),
          },
        });
      let res;
      try {
        res = await write(true);
      } catch (err) {
        if (!isMissingColumn(err)) throw err;
        // Schema not pushed yet: names can't be stored, so don't report success (client keeps retrying).
        if (speakerNames) {
          return Response.json({ error: "Speaker names are not available yet. Try again later." }, { status: 503 });
        }
        res = await write(false);
      }
      if (res.count) nextLen = next.length;
    }
    if (nextLen < 0) {
      return Response.json({ error: "Meeting was changed at the same time. Try again." }, { status: 503 });
    }
    return Response.json({ ok: true, parts: nextLen });
  } catch (err) {
    return dbDown(err);
  }
}
