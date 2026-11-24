import { APICallError, RetryError } from "ai";

/** Strip a ```markdown fence if the model wraps its whole answer in one. */
export function unwrapFence(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```$/);
  return m ? m[1] : text.trim();
}

/** Turn an AI provider failure into a friendly message and an HTTP status. */
export function aiFailure(error: unknown): { message: string; status: number } {
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
