import { FailureLimiter } from "./adminAuthCore.ts";

export const TOO_MANY_ATTEMPTS = "Too many attempts. Try again in a few minutes.";

export const normalizeEmail = (email: string) => email.toLowerCase().trim();

/** First address in an x-forwarded-for style header value, or "unknown". */
export function clientIp(header: string | string[] | null | undefined): string {
  const v = Array.isArray(header) ? header[0] : header;
  return (v ?? "").split(",")[0].trim() || "unknown";
}

/**
 * Failed-attempt counting for password sign-in: per email (10 per 15 minutes) and per IP (30 per 15 minutes).
 * In-memory, so best effort per serverless instance. A success clears the email's counter.
 */
export class LoginGuard {
  private byEmail: FailureLimiter;
  private byIp: FailureLimiter;
  constructor(emailMax = 10, ipMax = 30, windowMs = 15 * 60 * 1000) {
    this.byEmail = new FailureLimiter(emailMax, windowMs);
    this.byIp = new FailureLimiter(ipMax, windowMs);
  }
  blocked(email: string, ip: string, now = Date.now()): boolean {
    return this.byEmail.blocked(normalizeEmail(email), now) || (ip !== "unknown" && this.byIp.blocked(ip, now));
  }
  fail(email: string, ip: string, now = Date.now()): void {
    this.byEmail.fail(normalizeEmail(email), now);
    if (ip !== "unknown") this.byIp.fail(ip, now);
  }
  success(email: string): void {
    this.byEmail.clear(normalizeEmail(email));
  }
}
