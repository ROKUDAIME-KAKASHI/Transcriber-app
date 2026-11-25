import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, isStakeholdersMissing, livePeople, pausedResponse, stakeholdersMissing } from "@/lib/stakeholdersDb";
import { ImportBody, normEmail } from "@/lib/stakeholders";

export const dynamic = "force-dynamic";

/** Bulk add up to 200 people. Anyone whose email is already in the directory (or repeated in the list) is skipped. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  const parsed = ImportBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid list" }, { status: 400, headers: NO_STORE });
  }
  try {
    const seen = new Set((await livePeople(userId)).map((p) => normEmail(p.email)).filter(Boolean));
    const fresh = [];
    let skipped = 0;
    for (const p of parsed.data.people) {
      const e = normEmail(p.email);
      if (e && seen.has(e)) {
        skipped++;
        continue;
      }
      if (e) seen.add(e);
      fresh.push({ userId, name: p.name, designation: p.designation ?? null, organisation: p.organisation ?? null, area: p.area ?? null, email: e || null });
    }
    if (fresh.length) await prisma.stakeholder.createMany({ data: fresh });
    return Response.json({ created: fresh.length, skipped }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholder import error:", err);
    return Response.json({ error: "Couldn't import these people. Try again." }, { status: 503, headers: NO_STORE });
  }
}
