import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, ADMIN_TTL_MS, FailureLimiter, createToken, verifyPassword } from "@/lib/adminAuthCore";
import { adminSecret } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });
const limiter = new FailureLimiter(5, 15 * 60 * 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const started = Date.now();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Constant ~1 s on every attempt, whatever the outcome.
  const finish = async (body: object, status: number) => {
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
    return json(body, status);
  };

  if (limiter.blocked(ip)) return finish({ error: "Too many attempts. Try again later." }, 429);

  let parsed: z.infer<typeof Body> | null = null;
  try {
    const r = Body.safeParse(await req.json());
    parsed = r.success ? r.data : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    limiter.fail(ip);
    return finish({ error: "Incorrect password." }, 401);
  }

  const secret = adminSecret();
  const ok = Boolean(secret) && verifyPassword(parsed.password, process.env.ADMIN_PASSWORD_HASH);
  if (!ok || !secret) {
    limiter.fail(ip);
    return finish({ error: "Incorrect password." }, 401);
  }

  limiter.clear(ip);
  await sleep(Math.max(0, 1000 - (Date.now() - started)));
  const res = json({ ok: true }, 200);
  res.cookies.set(ADMIN_COOKIE, createToken(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(ADMIN_TTL_MS / 1000),
  });
  return res;
}
