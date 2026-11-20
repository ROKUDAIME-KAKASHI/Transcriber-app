import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { DEFAULT_SUMMARY_MODEL, SUMMARY_MODELS, type SummaryModel } from "./aiModels";

/**
 * The model that writes Minutes / Reports.
 * - AICREDITS_API_KEY set → AICredits.in (OpenAI-compatible gateway, billed in INR), using the
 *   model picked on the meeting page (see aiModels.ts).
 * - Otherwise GOOGLE_GENERATIVE_AI_API_KEY → Gemini directly (the choice is ignored).
 * Server-side only: never import this from client code.
 */
export function summaryModel(choice: SummaryModel = DEFAULT_SUMMARY_MODEL): LanguageModel {
  const aicreditsKey = process.env.AICREDITS_API_KEY;
  if (aicreditsKey) {
    const aicredits = createOpenAICompatible({
      name: "aicredits",
      baseURL: process.env.AICREDITS_BASE_URL || "https://api.aicredits.in/v1",
      apiKey: aicreditsKey,
    });
    const model = SUMMARY_MODELS.find((m) => m.value === choice) ?? SUMMARY_MODELS[0];
    return aicredits.chatModel(model.id);
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return google("gemini-flash-latest");
  throw new Error("AI summaries aren't set up on this server: add AICREDITS_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY).");
}
