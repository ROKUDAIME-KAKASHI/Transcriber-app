import { generateText } from "ai";
import { z } from "zod";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { getUserId, unauthorized } from "@/lib/auth";
import { isFlagOn } from "@/lib/flags";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { logServerError } from "@/lib/serverLog";
import { aiSpeakerLabel } from "@/lib/transcript";
import { loadMeetingForAi } from "@/lib/meetingForAi";
import {
  ASK_SYSTEM, MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, askPrompt, chunkTranscript, parseAskReply, renderContext,
  selectChunks, trimHistory,
} from "@/lib/askMeeting";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Best-effort per-user cap on AI calls (per server instance) to bound cost. */
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

const Body = z.object({
  question: z.string().trim().min(2).max(MAX_QUESTION_CHARS),
  history: z
    .array(z.object({ q: z.string().max(MAX_HISTORY_CHARS * 2), a: z.string().max(MAX_HISTORY_CHARS * 2) }))
    .max(MAX_HISTORY_TURNS * 3)
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!(await isFlagOn("meetingAsk"))) return Response.json({ error: "Not available" }, { status: 404 });
  const { id } = await params;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Ask a question of 2 to 500 characters." }, { status: 400 });
  if (limiter.blocked(userId)) return Response.json({ error: "Too many questions. Try again later." }, { status: 429 });
  limiter.fail(userId);

  let meeting;
  try {
    meeting = await loadMeetingForAi(id, userId);
  } catch (err) {
    logServerError("POST /api/meetings/[id]/ask lookup", err);
    return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
  }
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });
  if (!meeting.parts.some((p) => p.text.trim())) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  const chunks = chunkTranscript(meeting.parts, (s) => aiSpeakerLabel(s, meeting.names));
  const picked = selectChunks(chunks, body.data.question);
  // Quotes are checked against the whole transcript, not only the excerpts that were sent.
  const haystack = meeting.parts.map((p) => p.text).join("\n");

  try {
    const r = await generateText({
      model: summaryModel("glm"),
      system: ASK_SYSTEM,
      prompt: askPrompt({
        title: meeting.title,
        question: body.data.question,
        context: renderContext(picked),
        history: trimHistory(body.data.history),
      }),
      maxOutputTokens: 800,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(45_000),
    });
    const reply = parseAskReply(r.text, haystack);
    if (!reply) return Response.json({ error: "The AI reply could not be read. Try asking again." }, { status: 502 });
    return Response.json({ ...reply, excerpts: picked.length, of: chunks.length });
  } catch (error) {
    logServerError("POST /api/meetings/[id]/ask", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
