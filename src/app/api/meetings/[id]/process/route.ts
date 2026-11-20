import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { parseTranscript, transcriptToText } from "@/lib/transcript";

// Long meetings make long prompts; give the model time (Vercel allows up to 300 s).
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

const Body = z.object({ template: z.enum(["MOM", "Report"]).default("MOM") });

/** Strip a ```markdown fence if the model wraps its whole answer in one. */
function unwrapFence(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```$/);
  return m ? m[1] : text.trim();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid template" }, { status: 400 });
  const { template } = parsed.data;

  const meeting = await prisma.meeting.findFirst({ where: { id, userId } });
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });

  const parts = parseTranscript(meeting.transcript);
  // [mm:ss] text per line; "Speaker N:" only when the meeting has several speakers (cloud recordings).
  const raw = transcriptToText(parts);
  const words = parts.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
  const includeFullTranscript = words <= FULL_TRANSCRIPT_MAX_WORDS;
  if (!raw.trim()) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  try {
    const result = await generateText({
      model: google("gemini-flash-latest"),
      system: PROMPTS[template] + (includeFullTranscript ? FULL_TRANSCRIPT_SECTION : ""),
      prompt: `Meeting: ${meeting.title}\nLength: ${Math.round(meeting.durationSec / 60)} min\n\nRaw transcript:\n\n${raw}`,
    });
    const document = unwrapFence(result.text);
    if (!document) throw new Error("The AI returned an empty response.");

    await prisma.meeting.update({ where: { id }, data: { document, template } });
    return Response.json({ document, template });
  } catch (error) {
    console.error("Process error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
