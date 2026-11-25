import { generateText } from "ai";
import { logServerError } from "@/lib/serverLog";
import { summaryModel } from "@/lib/ai";
import { aiFailure } from "@/lib/aiErrors";
import { getUserId, unauthorized } from "@/lib/auth";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { PolishBody, buildPolishPrompt, cleanPolished } from "@/lib/followUpAgenda";

/** Best-effort per-user cap on AI calls (per server instance) to bound cost. */
const limiter = new FailureLimiter(30, 60 * 60 * 1000);

export const maxDuration = 60;

/** Rewrite a follow-up agenda draft more naturally. The draft stays the default; this is optional. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (limiter.blocked(userId)) return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  limiter.fail(userId);
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
    logServerError("POST /api/agenda/polish", error);
    const { message, status } = aiFailure(error);
    return Response.json({ error: message }, { status });
  }
}
