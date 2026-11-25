import { generateText } from "ai";
import { z } from "zod";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { DEFAULT_SUMMARY_MODEL } from "@/lib/aiModels";
import { prisma } from "@/lib/prisma";
import { isFlagOn } from "@/lib/flags";
import { planPromptBlock } from "@/lib/planning";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { logServerError } from "@/lib/serverLog";
import { transcriptToText } from "@/lib/transcript";
import { labelledLines, loadMeetingForAi } from "@/lib/meetingForAi";
import { COMBINED_MAX_WORDS, capTranscript, combinedPrompt, oneLine, combinedSystem, parseCombined, parseSummaryOnly, summarySystem } from "@/lib/combined";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Best-effort per-user cap on AI calls (per server instance) to bound cost. */
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

/** One run per meeting at a time on this server instance: a duplicate request waits for the first and gets its result. */
const inflight = new Map<string, Promise<Response>>();

const Body = z.object({
  template: z.enum(["MOM", "Report"]).default("MOM"),
  model: z.enum(["glm", "haiku"]).default(DEFAULT_SUMMARY_MODEL),
  /** True when the user asked to rewrite existing minutes. Without it a meeting that already has a document is never regenerated. */
  force: z.boolean().default(false),
  /** "summary" writes only the summary (used when the combined reply had none). */
  only: z.enum(["summary"]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!(await isFlagOn("autoMinutes"))) return Response.json({ error: "Not available", fallback: true }, { status: 404 });
  const { id } = await params;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const key = `${userId}:${id}:${body.data.only ?? "all"}:${body.data.template}:${body.data.model}:${body.data.force ? 1 : 0}`;
  const running = inflight.get(key);
  if (running) return (await running).clone();

  const p = run(userId, id, body.data);
  inflight.set(key, p);
  try {
    return (await p).clone();
  } finally {
    inflight.delete(key);
  }
}

async function run(userId: string, id: string, opts: z.infer<typeof Body>): Promise<Response> {
  let meeting;
  try {
    meeting = await loadMeetingForAi(id, userId);
  } catch (err) {
    logServerError("POST /api/meetings/[id]/generate lookup", err);
    return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
  }
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });

  const words = meeting.parts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
  if (!words) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  // Once only: a meeting that already has minutes is returned as is unless the user asked to rewrite them.
  if (meeting.document && !opts.force && !opts.only) {
    return Response.json({ document: meeting.document, template: meeting.template ?? "MOM", alreadyDone: true });
  }
  // Long meetings keep the existing chunked path.
  if (words > COMBINED_MAX_WORDS && !opts.only) return Response.json({ fallback: true, reason: "long" });

  if (limiter.blocked(userId)) return Response.json({ error: "Too many AI requests. Try again later." }, { status: 429 });
  limiter.fail(userId);

  const multiSpeaker = new Set(meeting.parts.map((p) => p.speaker)).size > 1;
  const raw = transcriptToText(meeting.parts, { names: meeting.names, multiSpeaker, forAi: true });
  const header = `Meeting: ${oneLine(meeting.title)}\nLength: ${Math.round(meeting.durationSec / 60)} min`;
  const model = summaryModel(opts.model);

  try {
    if (opts.only === "summary") {
      const r = await generateText({
        model,
        system: summarySystem(),
        prompt: combinedPrompt(header, capTranscript(raw)),
        maxOutputTokens: 1500,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const summary = parseSummaryOnly(r.text);
      if (!summary) return Response.json({ error: "The AI reply could not be read. Try again." }, { status: 502 });
      return Response.json({ summary });
    }

    let planBlock = "";
    try {
      if (await isFlagOn("plannedMeetings")) {
        const plan = await prisma.plannedMeeting.findFirst({
          where: { meetingId: id, userId, deletedAt: null },
          select: { title: true, venue: true, agenda: true, attendees: { select: { name: true, designation: true } } },
        });
        planBlock = planPromptBlock(plan);
      }
    } catch {
      planBlock = "";
    }

    const r = await generateText({
      model,
      system: combinedSystem(opts.template, planBlock),
      prompt: combinedPrompt(header, raw),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(200_000),
    });
    // Quotes are checked against the same labelled lines the separate extractor reads.
    const parsed = parseCombined(r.text, labelledLines(meeting.parts, meeting.names).join("\n"));
    if (!parsed.ok) {
      logServerError("POST /api/meetings/[id]/generate parse", new Error(parsed.reason));
      return Response.json({ fallback: true, reason: parsed.reason });
    }

    // Save the minutes. Without force only a meeting that still has none is written, so a duplicate request cannot overwrite.
    const where = opts.force ? { id, userId } : { id, userId, OR: [{ document: null }, { document: "" }] };
    const saved = await prisma.meeting.updateMany({ where, data: { document: parsed.minutes, template: opts.template } });
    if (saved.count === 0) {
      const now = await prisma.meeting.findFirst({ where: { id, userId }, select: { document: true, template: true } });
      if (now?.document) return Response.json({ document: now.document, template: now.template ?? "MOM", alreadyDone: true });
      return Response.json({ error: "Meeting not found" }, { status: 404 });
    }
    return Response.json({
      document: parsed.minutes,
      template: opts.template,
      summary: parsed.summary,
      items: parsed.items,
    });
  } catch (error) {
    logServerError("POST /api/meetings/[id]/generate", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
