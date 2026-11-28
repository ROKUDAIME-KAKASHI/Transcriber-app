import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { clientIp, TOO_MANY_ATTEMPTS } from "@/lib/loginLimit";
import { passwordProblem } from "@/lib/passwordRule";
import { RESET_INVALID, matchesPassword, verifyResetToken } from "@/lib/resetToken";

// Best effort per instance: 10 attempts per IP per hour.
const limiter = new FailureLimiter(10, 60 * 60 * 1000);

const Body = z.object({ token: z.string().min(1), password: z.string().min(1, "Password is required") });

export async function POST(req: Request) {
  const ip = clientIp(req.headers.get("x-forwarded-for"));
  if (ip !== "unknown") {
    if (limiter.blocked(ip)) return Response.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 });
    limiter.fail(ip);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: RESET_INVALID }, { status: 400 });

  const payload = verifyResetToken(parsed.data.token, process.env.NEXTAUTH_SECRET);
  if (!payload) return Response.json({ error: RESET_INVALID }, { status: 400 });
  const weak = passwordProblem(parsed.data.password);
  if (weak) return Response.json({ error: weak }, { status: 400 });
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.uid }, select: { id: true, password: true } });
    if (!user || !matchesPassword(payload, user.password)) return Response.json({ error: RESET_INVALID }, { status: 400 });
    const password = await bcrypt.hash(parsed.data.password, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Password reset error:", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Couldn't update the password. Please try again." }, { status: 500 });
  }
}
