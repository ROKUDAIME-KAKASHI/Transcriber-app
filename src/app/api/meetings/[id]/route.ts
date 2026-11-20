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

const PatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  transcript: z
    .array(z.object({ speaker: z.number().int().min(0), text: z.string().max(5000), t: z.number().min(0).optional() }))
    .max(20000)
    .optional(),
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

  // updateMany scoped by userId so nobody can write to another account's meeting.
  try {
    const { count } = await prisma.meeting.updateMany({ where: { id, userId }, data: parsed.data });
    return count ? Response.json({ ok: true }) : notFound();
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
