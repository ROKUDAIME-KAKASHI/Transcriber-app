/** Logs a server-side failure with its route name so it is easy to find in the Vercel logs. */
export function logServerError(route: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "non-error thrown");
  console.error(`[server-error] ${route}: ${e.name}: ${e.message.slice(0, 500)}`);
}
