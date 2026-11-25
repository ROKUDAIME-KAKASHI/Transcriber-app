import { z } from "zod";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { getUserId } from "@/lib/auth";
import { ERROR_KINDS, LIMITS, fingerprint, sanitizeUrl, scrubMessage, scrubStack } from "@/lib/errorLogCore";
import { isErrorLogMissing } from "@/lib/errorLogDb";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/serverLog";

export const dynamic = "force-dynamic";

// Best-effort per-instance limiter: 30 reports per minute per IP.
const limiter = new FailureLimiter(30, 60_000);

const Body = z.object({
  kind: z.enum(ERROR_KINDS),
  message: z.string().min(1).max(2000),
  stack: z.string().max(20_000).optional(),
  url: z.string().max(2000).optional(),
  appVersion: z.string().max(LIMITS.appVersion).optional(),
});

const noContent = () => new Response(null, { status: 204 });

/** Public on purpose (errors can happen before sign-in). Always answers 204 so the client never retries or shows anything. */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limiter.blocked(ip)) return noContent();
  limiter.fail(ip);

  if (Number(req.headers.get("content-length") ?? 0) > 40_000) return noContent();
  const raw = await req.text().catch(() => "");
  if (raw.length > 40_000) return noContent();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return noContent();
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return noContent();
  const b = parsed.data;

  const message = scrubMessage(b.message);
  const stack = b.stack ? scrubStack(b.stack) : null;
  const fp = fingerprint(b.kind, message, stack);
  const now = new Date();

  try {
    const userId = await getUserId().catch(() => null);
    const existing = await prisma.clientError.findFirst({ where: { fingerprint: fp }, select: { id: true } });
    if (existing) {
      await prisma.clientError.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastSeenAt: now, appVersion: b.appVersion ?? undefined },
      });
    } else {
      await prisma.clientError.create({
        data: {
          userId,
          kind: b.kind,
          message,
          stack,
          url: sanitizeUrl(b.url),
          userAgent: (req.headers.get("user-agent") ?? "").slice(0, LIMITS.userAgent) || null,
          appVersion: b.appVersion ?? null,
          fingerprint: fp,
          lastSeenAt: now,
        },
      });
    }
  } catch (err) {
    if (!isErrorLogMissing(err)) logServerError("POST /api/client-errors", err);
  }
  return noContent();
}
