import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { parseTranscript, transcriptToText } from "@/lib/transcript";

export const maxDuration = 60;

const PROMPTS: Record<"MOM" | "Report", string> = {
  Report: `You are an expert executive assistant. You will be given a raw meeting transcript from an on-device speech recogniser, one phrase per line (older recordings may have "Speaker N:" labels). It may contain misheard words; fix them only when the correct word is clear from context. The recogniser does not separate speakers, so do not invent names or attribute statements to people unless the transcript itself makes it clear.
Your job is to generate a professional Report with the following structure in Markdown:

# Report Overview
(Write a cohesive paragraph summarizing the meeting topic and overall context.)

# Key Findings
- (List major findings or points discussed)

# Conclusion & Next Steps
- (List steps or follow-ups)

# Full Transcript
(Provide the fully cleaned transcript. Fix obvious typos and add perfect punctuation. Write it as flowing paragraphs without "Speaker X" tags. Do not change the original meaning.)`,
  MOM: `You are an expert executive assistant. You will be given a raw meeting transcript from an on-device speech recogniser, one phrase per line (older recordings may have "Speaker N:" labels). It may contain misheard words; fix them only when the correct word is clear from context. The recogniser does not separate speakers, so do not invent names or attribute statements to people unless the transcript itself makes it clear.
Your job is to generate a professional Meeting Document with the following structure in Markdown:

# Executive Summary
(Write a cohesive paragraph summarizing the entire meeting.)

# Minutes of the Meeting
- **Key Decisions:** (List any decisions made)
- **Action Items:** (List tasks assigned and to whom, if any)
- **Key Discussion Points:** (Bullet points of main topics discussed)

# Full Transcript
(Provide the fully cleaned transcript. Fix obvious typos and add perfect punctuation. Write it as flowing paragraphs without "Speaker X" tags. Do not change the original meaning.)`,
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
  // One speaker (the normal case now): plain text reads better to the model than a
  // "Speaker 1:" prefix on every phrase. Older meetings with several speakers keep their labels.
  const singleSpeaker = new Set(parts.map((p) => p.speaker)).size <= 1;
  const raw = singleSpeaker ? parts.map((p) => p.text).join("\n") : transcriptToText(parts);
  if (!raw.trim()) return Response.json({ error: "This meeting has no transcript yet." }, { status: 400 });

  try {
    const result = await generateText({
      model: google("gemini-flash-latest"),
      system: PROMPTS[template],
      prompt: `Here is the raw transcript:\n\n${raw}`,
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
