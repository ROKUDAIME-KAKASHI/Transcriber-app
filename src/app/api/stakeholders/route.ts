import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, PERSON_SELECT, duplicateResponse, findPossibleDuplicate, isStakeholdersMissing, livePeople, pausedResponse, stakeholdersMissing } from "@/lib/stakeholdersDb";
import { CreateBody } from "@/lib/stakeholders";

export const dynamic = "force-dynamic";

/** The user's live people, optionally filtered by ?q= (name, email, designation, organisation, area). */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const contains = { contains: q, mode: "insensitive" as const };
  try {
    const people = await prisma.stakeholder.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(q ? { OR: [{ name: contains }, { email: contains }, { designation: contains }, { organisation: contains }, { area: contains }] } : {}),
      },
      orderBy: { name: "asc" },
      take: 1000,
      select: PERSON_SELECT,
    });
    return Response.json({ people }, { headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholders list error:", err);
    return Response.json({ error: "Couldn't load your people. Try again." }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid details" }, { status: 400, headers: NO_STORE });
  }
  const force = raw?.force === true;
  try {
    const dup = findPossibleDuplicate(parsed.data, await livePeople(userId));
    // The same email is never allowed twice; a similar name only warns, and "force" saves it anyway.
    if (dup && (dup.reason === "email" || !force)) return duplicateResponse(dup);
    const person = await prisma.stakeholder.create({ data: { userId, ...parsed.data }, select: PERSON_SELECT });
    return Response.json({ person }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholder create error:", err);
    return Response.json({ error: "Couldn't save this person. Try again." }, { status: 503, headers: NO_STORE });
  }
}
