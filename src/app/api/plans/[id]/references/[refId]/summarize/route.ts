import { generateText } from "ai";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { logServerError } from "@/lib/serverLog";
import { NO_STORE, failed, notFound } from "@/lib/planningDb";
import { REFERENCE_SELECT, isPreworkMissing, preworkMissing, preworkPaused, toReferenceDTO } from "@/lib/preworkDb";
import { buildPointsPrompt, chunkDocument, mergePoints, parsePoints, verifyPoints, type RefPoint } from "@/lib/prework";

/** Best-effort per-user cap on AI calls (per server instance) to bound cost. */
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** AI points for one reference. Runs only when the user taps Summarise; the document text is never logged. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; refId: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await preworkPaused();
  if (paused) return paused;
  const { id, refId } = await params;
  if (limiter.blocked(userId)) {
    return Response.json({ error: "Too many summaries. Try again later." }, { status: 429, headers: NO_STORE });
  }

  let doc: string;
  try {
    const row = await prisma.planReference.findFirst({
      where: { id: refId, plannedMeetingId: id, userId, deletedAt: null, plannedMeeting: { deletedAt: null } },
      select: { text: true },
    });
    if (!row) return notFound("Reference");
    doc = row.text;
  } catch (err) {
    if (isPreworkMissing(err)) return preworkMissing();
    logServerError("POST /api/plans/[id]/references/[refId]/summarize lookup", err);
    return failed("Couldn't load this reference. Try again.");
  }
  limiter.fail(userId);

  const { chunks, truncated } = chunkDocument(doc);
  try {
    const lists: RefPoint[][] = [];
    for (const chunk of chunks) {
      const r = await generateText({
        model: summaryModel("glm"),
        prompt: buildPointsPrompt(chunk),
        maxOutputTokens: 2500,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
      });
      lists.push(verifyPoints(parsePoints(r.text), doc));
    }
    const points = mergePoints(lists);
    const updated = await prisma.planReference.update({
      where: { id: refId },
      data: { points: points as unknown as object, summarizedAt: new Date() },
      select: REFERENCE_SELECT,
    });
    return Response.json({ reference: toReferenceDTO(updated), partial: truncated }, { headers: NO_STORE });
  } catch (error) {
    logServerError("POST /api/plans/[id]/references/[refId]/summarize", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status, headers: NO_STORE });
  }
}
