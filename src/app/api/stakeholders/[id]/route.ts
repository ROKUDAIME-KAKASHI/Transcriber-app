import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PERSON_SELECT, duplicateResponse, findPossibleDuplicate, isStakeholdersMissing, livePeople, pausedResponse, stakeholdersMissing } from "@/lib/stakeholdersDb";
import { PatchBody } from "@/lib/stakeholders";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid details" }, { status: 400, headers: NO_STORE });
  }
  const force = raw?.force === true;
  try {
    const current = await prisma.stakeholder.findFirst({ where: { id, userId, deletedAt: null }, select: { name: true, email: true } });
    if (!current) return Response.json({ error: "Person not found" }, { status: 404, headers: NO_STORE });
    const next = {
      name: parsed.data.name ?? current.name,
      email: parsed.data.email === undefined ? current.email : parsed.data.email,
    };
    const changedIdentity = next.name !== current.name || (next.email ?? null) !== (current.email ?? null);
    if (changedIdentity) {
      const dup = findPossibleDuplicate(next, await livePeople(userId), id);
      if (dup && (dup.reason === "email" || !force)) return duplicateResponse(dup);
    }
    // Scoped to the owner: someone else's id is a 404.
    const { count } = await prisma.stakeholder.updateMany({ where: { id, userId, deletedAt: null }, data: parsed.data });
    if (!count) return Response.json({ error: "Person not found" }, { status: 404, headers: NO_STORE });
    const person = await prisma.stakeholder.findFirst({ where: { id, userId }, select: PERSON_SELECT });
    return Response.json({ person }, { headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholder update error:", err);
    return Response.json({ error: "Couldn't save the changes. Try again." }, { status: 503, headers: NO_STORE });
  }
}

/** Soft delete. Tasks and meetings only store the name text, so nothing that mentions this person is touched. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const { id } = await params;
  try {
    const { count } = await prisma.stakeholder.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) return Response.json({ error: "Person not found" }, { status: 404, headers: NO_STORE });
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholder delete error:", err);
    return Response.json({ error: "Couldn't delete this person. Try again." }, { status: 503, headers: NO_STORE });
  }
}
