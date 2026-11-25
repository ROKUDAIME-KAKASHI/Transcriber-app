import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { NO_STORE, isStakeholdersMissing, livePeople, pausedResponse, stakeholdersMissing } from "@/lib/stakeholdersDb";
import { buildSuggestions } from "@/lib/stakeholders";

export const dynamic = "force-dynamic";

/** "Add from your meetings": task owners, renamed speakers and booking guests that aren't in the directory yet. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await pausedResponse();
  if (paused) return paused;
  try {
    const existing = await livePeople(userId); // also surfaces a missing Stakeholder table
    // Each source is best effort: a failure in one never hides the others.
    const [owners, speakers, bookings] = await Promise.all([
      prisma.actionItem
        .findMany({ where: { userId, owner: { not: null } }, distinct: ["owner"], select: { owner: true }, take: 100 })
        .then((r) => r.map((x) => x.owner as string))
        .catch(() => [] as string[]),
      prisma.meeting
        .findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { speakerNames: true }, take: 100 })
        .then((r) =>
          r
            .flatMap((m) => (m.speakerNames && typeof m.speakerNames === "object" ? Object.values(m.speakerNames as Record<string, unknown>) : []))
            .filter((v): v is string => typeof v === "string")
        )
        .catch(() => [] as string[]),
      prisma.booking
        .findMany({ where: { hostUserId: userId }, orderBy: { createdAt: "desc" }, select: { guestName: true, guestEmail: true }, take: 100 })
        .then((r) => r.map((b) => ({ name: b.guestName, email: b.guestEmail })))
        .catch(() => [] as { name: string; email: string }[]),
    ]);
    return Response.json({ suggestions: buildSuggestions(existing, { owners, speakers, bookings }) }, { headers: NO_STORE });
  } catch (err) {
    if (isStakeholdersMissing(err)) return stakeholdersMissing();
    console.error("Stakeholder suggestions error:", err);
    return Response.json({ error: "Couldn't load suggestions." }, { status: 503, headers: NO_STORE });
  }
}
