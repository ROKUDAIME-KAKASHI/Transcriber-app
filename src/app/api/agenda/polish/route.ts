import { generateText } from "ai";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { getUserId, unauthorized } from "@/lib/auth";
import { PolishBody, buildPolishPrompt, cleanPolished } from "@/lib/followUpAgenda";

export const maxDuration = 60;

/** Rewrite a follow-up agenda draft more naturally. The draft stays the default; this is optional. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const body = PolishBody.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  try {
    const r = await generateText({
      model: summaryModel("glm"),
      prompt: buildPolishPrompt(body.data.draft),
      maxOutputTokens: 3000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(45_000),
    });
    const text = cleanPolished(r.text);
    if (!text) return Response.json({ error: "The AI returned nothing. Try again." }, { status: 502 });
    return Response.json({ text });
  } catch (error) {
    console.error("Agenda polish error:", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
