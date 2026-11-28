import { generateText } from "ai";
import { z } from "zod";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { withLegacyFallback } from "@/lib/meetingSelect";
import { UNTRUSTED_LABELS_NOTE, aiSpeakerLabel, parseTranscript, type SpeakerNames, type TranscriptPart } from "@/lib/transcript";
import { TRANSCRIPT_DATA_RULE, wrapTranscript } from "@/lib/combined";
import { buildActionItemsPrompt, chunkLines, mergeItems, parseActionItems, verifyItems } from "@/lib/actionItems";

// Long meetings take a few model calls, two at a time (AICredits rejects more at once).
/** Best-effort per-user cap on AI calls (per server instance) to bound cost. */
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

export const maxDuration = 300;
const CHUNK_CONCURRENCY = 2;

const Body = z.object({
  /** Used only when the server copy of the transcript is empty (a fresh recording still syncing). */
  transcript: z
    .array(z.object({ speaker: z.number().int().min(0).max(49), text: z.string().max(5000), t: z.number().min(0).optional() }))
    .max(20_000)
    .optional(),
  speakerNames: z.record(z.string().regex(/^\d{1,2}$/), z.string().max(60)).nullable().optional(),
});

function toLines(parts: TranscriptPart[], names: SpeakerNames): string[] {
  const multi = new Set(parts.map((p) => p.speaker)).size > 1;
  // One line per phrase: newlines inside a phrase must not forge extra "Name:" lines.
  return parts
    .map((p) => ({ who: aiSpeakerLabel(p.speaker, names), text: p.text.replace(/\s+/g, " ").trim() }))
    .filter((p) => p.text)
    .map((p) => (multi ? `${p.who}: ${p.text}` : p.text));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (limiter.blocked(userId)) return Response.json({ error: "Too many extractions. Try again later." }, { status: 429 });
  limiter.fail(userId);

  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  let meeting;
  try {
    meeting = await withLegacyFallback(async (legacy) => {
      const where = { id, userId };
      if (legacy) {
        const m = await prisma.meeting.findFirst({ where, select: { transcript: true } });
        return m && { ...m, speakerNames: null as unknown };
      }
      return prisma.meeting.findFirst({ where, select: { transcript: true, speakerNames: true } });
    });
  } catch (err) {
    console.error("Action items lookup error:", err);
    return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
  }
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });

  let parts = parseTranscript(meeting.transcript);
  const sn = meeting.speakerNames;
  let names: SpeakerNames =
    sn && typeof sn === "object" && !Array.isArray(sn) && Object.values(sn).every((v) => typeof v === "string")
      ? (sn as Record<string, string>)
      : null;
  if (!parts.length && body.data.transcript?.length) {
    parts = body.data.transcript;
    names = body.data.speakerNames ?? names;
  }
  const lines = toLines(parts, names);
  if (!lines.length) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  const { chunks, truncated } = chunkLines(lines);
  const fullText = lines.join("\n");

  try {
    const results: ReturnType<typeof parseActionItems>[] = new Array(chunks.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
        while (next < chunks.length) {
          const i = next++;
          const r = await generateText({
            model: summaryModel("glm"),
            system: (TRANSCRIPT_DATA_RULE + UNTRUSTED_LABELS_NOTE).trim(),
            prompt: buildActionItemsPrompt(wrapTranscript(chunks[i])),
            maxOutputTokens: 4000,
            maxRetries: 1,
            abortSignal: AbortSignal.timeout(120_000),
          });
          results[i] = parseActionItems(r.text);
        }
      })
    );
    const items = mergeItems(results.map((r) => verifyItems(r, fullText)));
    return Response.json({ items, truncated });
  } catch (error) {
    console.error("Action items extract error:", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
