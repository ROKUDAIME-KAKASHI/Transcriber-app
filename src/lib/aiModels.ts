/**
 * The AI models offered for Minutes / Reports (via AICredits.in). Safe to import on the client:
 * the browser only sends the short `value`; the server maps it to the model id.
 * Costs are rough figures for a one-hour meeting (tested Nov 2026).
 */
export const SUMMARY_MODELS = [
  {
    value: "glm",
    id: "z-ai/glm-flash-latest",
    label: "Economy · GLM Flash",
    hint: "About ₹0.25 per hour of meeting. Accurate decisions and action items; good for everyday meetings.",
  },
  {
    value: "haiku",
    id: "anthropic/claude-haiku-latest",
    label: "Best · Claude Haiku",
    hint: "About ₹0.50 per hour of meeting. Most thorough: catches more action items and flags anything uncertain.",
  },
] as const;

export type SummaryModel = (typeof SUMMARY_MODELS)[number]["value"];
export const DEFAULT_SUMMARY_MODEL: SummaryModel = "glm";
