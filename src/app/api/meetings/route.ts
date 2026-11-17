import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const meetings = await prisma.meeting.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, status: true, language: true, durationSec: true,
      deviceName: true, template: true, createdAt: true, updatedAt: true,
    },
  });
  return Response.json({ meetings });
}

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  language: z.string().max(10).default("en"),
  deviceName: z.string().max(60).optional(),
});

/** Called when a device starts recording, so the meeting exists (and autosaves) from second one. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { title, language, deviceName } = parsed.data;
  const meeting = await prisma.meeting.create({
    data: {
      userId,
      title: title ?? `Meeting – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
      language,
      deviceName,
    },
    select: { id: true, title: true },
  });
  return Response.json({ meeting }, { status: 201 });
}
