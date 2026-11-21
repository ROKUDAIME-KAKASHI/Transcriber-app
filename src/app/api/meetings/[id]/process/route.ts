import { APICallError, RetryError, generateText } from "ai";
import { z } from "zod";
import { summaryModel } from "@/lib/ai";
import { DEFAULT_SUMMARY_MODEL } from "@/lib/aiModels";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { parseTranscript, transcriptToText } from "@/lib/transcript";

// Long meetings take several AI calls. 300 s is the most every Vercel plan allows; if the platform cuts
// the request off, the meeting page keeps checking and shows the document once it has been saved.
export const maxDuration = 300;

/**
 * Above this many words, the document skips the cleaned "Full Transcript" section: rewriting an
 * hour of speech can exceed the model's output limit and the request time, and the raw
 * transcript is on the meeting page anyway.
 */
const FULL_TRANSCRIPT_MAX_WORDS = 3500;

const CONTEXT = `You are an expert executive assistant writing up a meeting.
You will be given a raw meeting transcript from a speech recogniser: one phrase per line, each starting with a [mm:ss] or [hh:mm:ss] time into the meeting (older recordings may lack times). Cloud recordings label who is talking as "Speaker N:"; on-device recordings have no labels.
- The recogniser makes mistakes. Fix misheard words only when the right word is clear from context; never invent content.
- With "Speaker N:" labels, attribute statements, decisions and action items to that speaker. Use a real name instead only when the transcript makes it clear who Speaker N is (e.g. they introduce themselves or are addressed by name). Speaker separation is automatic and can occasionally mix two people up.
- Without labels, the speakers are not separated: do not invent names or attribute statements to people unless the transcript makes it clear (e.g. someone is addressed by name, or says "I'll do it").
- Parts may be in Hindi (Devanagari) or mixed Hindi-English. Write the document in English; quote Hindi only where the exact wording matters.
- Where useful, cite when something was said with its time in brackets, e.g. (12:40), so readers can find it in the transcript.
- Be concise and specific: names, numbers, dates and deadlines exactly as said. If a section has nothing, write "None recorded."
- Output Markdown only.`;

const FULL_TRANSCRIPT_SECTION = `

# Full Transcript
(The transcript cleaned up: fix obvious recognition errors, add punctuation, and join phrases into readable paragraphs. Start each paragraph with the time of its first phrase in brackets. Keep the original language and meaning; do not summarise.)`;

const PROMPTS: Record<"MOM" | "Report", string> = {
  MOM: `${CONTEXT}

Produce Minutes of Meeting with exactly this structure:

# Summary
(One short paragraph: purpose of the meeting and the outcome.)

# Decisions
- (Each decision made, with its time.)

# Action Items
| # | Task | Owner | Due | Time |
|---|------|-------|-----|------|
(One row per task. Owner and Due only if stated; otherwise "—".)

# Discussion
## (Topic)
- (Key points per topic, in the order discussed.)

# Open Questions
- (Unresolved issues, disagreements, or things to follow up.)`,
  Report: `${CONTEXT}

Produce a Meeting Report with exactly this structure:

# Overview
(One paragraph: context, purpose and participants if mentioned.)

# Key Points
- (Main findings, figures and arguments, with times.)

# Decisions & Next Steps
- (What was agreed and what happens next, with owners and dates if stated.)

# Risks & Open Questions
- (Concerns raised and unresolved issues.)`,
};

const Body = z.object({
  template: z.enum(["MOM", "Report"]).default("MOM"),
  model: z.enum(["glm", "haiku"]).default(DEFAULT_SUMMARY_MODEL),
});

/**
 * Long meetings (hours) are summarised in two steps: detailed notes per part, then the document
 * from those notes. One request with a 10-hour transcript (~100k words) is slow, can time out,
 * and models lose detail in the middle of very long inputs.
 */
const LONG_MEETING_WORDS = 18_000;
const CHUNK_WORDS = 12_000;
/** AICredits rejects too many simultaneous requests ("Concurrency Limit Exceeded"). */
const CHUNK_CONCURRENCY = 2;

const NOTES_PROMPT = `You are taking detailed notes on ONE PART of a long meeting transcript (lines start with [hh:mm:ss] times; "Speaker N:" labels when present).
Write concise Markdown notes for this part only, keeping the times in brackets:
- Topics discussed, with the key points and figures exactly as said
- Decisions made
- Action items (task, owner if stated, deadline if stated)
- Open questions or disagreements
Fix obviously misheard words only when clear from context; never invent content. Write in English (quote Hindi only where wording matters).`;

type Parts = ReturnType<typeof parseTranscript>;

function splitIntoChunks(parts: Parts): Parts[] {
  const chunks: Parts[] = [];
  let current: Parts = [];
  let words = 0;
  for (const p of parts) {
    const n = p.text.split(/\s+/).length;
    if (words + n > CHUNK_WORDS && current.length) {
      chunks.push(current);
      current = [];
      words = 0;
    }
    current.push(p);
    words += n;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/** Strip a ```markdown fence if the model wraps its whole answer in one. */
function unwrapFence(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```$/);
  return m ? m[1] : text.trim();
}

/** Turn an AI provider failure into a friendly message and an HTTP status. */
function aiFailure(error: unknown): { message: string; status: number } {
  const root = RetryError.isInstance(error) && error.lastError ? error.lastError : error;
  const name = root instanceof Error ? root.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { message: "The AI took too long. Try again, or pick GLM Flash.", status: 504 };
  }
  if (APICallError.isInstance(root)) {
    const code = root.statusCode;
    if (code === 402) return { message: "Your AI credits have run out. Top up at aicredits.in.", status: 402 };
    if (code === 429) return { message: "The AI service is busy (too many requests at once). Try again in a minute.", status: 429 };
    if (code === 401 || code === 403) return { message: "The AI key on the server is invalid.", status: 502 };
    if (code === 408 || code === 504) return { message: "The AI took too long. Try again, or pick GLM Flash.", status: 504 };
  }
  const message = root instanceof Error ? root.message : "Unknown error";
  return { message, status: 502 };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid template" }, { status: 400 });
  const { template, model } = parsed.data;

  let meeting;
  try {
    meeting = await prisma.meeting.findFirst({
      where: { id, userId },
      select: { title: true, durationSec: true, transcript: true },
    });
  } catch (err) {
    console.error("Process lookup error:", err);
    return Response.json({ error: "The database is waking up. Try again in a few seconds." }, { status: 503 });
  }
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });

  const parts = parseTranscript(meeting.transcript);
  // [mm:ss] text per line; "Speaker N:" only when the meeting has several speakers (cloud recordings).
  const raw = transcriptToText(parts);
  const words = parts.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
  const includeFullTranscript = words <= FULL_TRANSCRIPT_MAX_WORDS;
  if (!raw.trim()) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  try {
    const header = `Meeting: ${meeting.title}\nLength: ${Math.round(meeting.durationSec / 60)} min`;
    let prompt = `${header}\n\nRaw transcript:\n\n${raw}`;
    if (words > LONG_MEETING_WORDS) {
      // Step 1: detailed notes per part (in order), a couple at a time.
      const chunks = splitIntoChunks(parts);
      const multiSpeaker = new Set(parts.map((p) => p.speaker)).size > 1;
      const notes = await mapLimit(chunks, CHUNK_CONCURRENCY, async (chunk, i) => {
        const r = await generateText({
          model: summaryModel(model),
          maxOutputTokens: 4000,
          maxRetries: 2,
          abortSignal: AbortSignal.timeout(180_000),
          system: NOTES_PROMPT,
          prompt: `Part ${i + 1} of ${chunks.length}${multiSpeaker ? " (speaker labels are consistent across parts)" : ""}:\n\n${transcriptToText(chunk)}`,
        });
        return `## Part ${i + 1} of ${chunks.length}\n\n${r.text.trim()}`;
      });
      // Step 2: the document, written from the notes.
      prompt = `${header}\n\nThe transcript was too long to include, so here are detailed notes taken from each consecutive part of it (times are into the meeting). Write the document from these notes; merge topics that span parts.\n\n${notes.join("\n\n")}`;
    }
    const result = await generateText({
      model: summaryModel(model),
      maxOutputTokens: 16000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(240_000),
      system: PROMPTS[template] + (includeFullTranscript ? FULL_TRANSCRIPT_SECTION : ""),
      prompt,
    });
    const document = unwrapFence(result.text);
    if (!document) throw new Error("The AI returned an empty response.");

    await prisma.meeting.update({ where: { id }, data: { document, template } });
    return Response.json({ document, template });
  } catch (error) {
    console.error("Process error:", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
