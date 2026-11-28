import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FailureLimiter } from "@/lib/adminAuthCore";
import { clientIp, normalizeEmail, TOO_MANY_ATTEMPTS } from "@/lib/loginLimit";
import { emailConfigured, sendMail } from "@/lib/bookingEmail";
import { signResetToken } from "@/lib/resetToken";

// Best effort per instance: 3 requests per email and 10 per IP, per hour.
const byEmail = new FailureLimiter(3, 60 * 60 * 1000);
const byIp = new FailureLimiter(10, 60 * 60 * 1000);

const SAME_ANSWER = { message: "If an account exists for that email, we've sent a reset link." };
const Body = z.object({ email: z.string().email() });

/** Lets the UI hide "Forgot password?" when no email provider is set up. */
export async function GET() {
  return Response.json({ enabled: emailConfigured() });
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers.get("x-forwarded-for"));
  if (ip !== "unknown") {
    if (byIp.blocked(ip)) return Response.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 });
    byIp.fail(ip);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  // Past the per-email limit we still answer the same way, so nothing leaks.
  if (byEmail.blocked(email)) return Response.json(SAME_ANSWER);
  byEmail.fail(email);

  const secret = process.env.NEXTAUTH_SECRET;
  if (!emailConfigured() || !secret) return Response.json(SAME_ANSWER);
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, password: true } });
    if (user) {
      // The origin comes from server config, falling back to the request URL, never from user input.
      let origin = new URL(req.url).origin;
      try {
        if (process.env.NEXTAUTH_URL) origin = new URL(process.env.NEXTAUTH_URL).origin;
      } catch {
        /* keep the request origin */
      }
      const link = `${origin}/reset?token=${signResetToken(user.id, user.password, secret)}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Minutely password",
        text: `Someone asked to reset the password for your Minutely account.\n\nReset it here (the link expires in 30 minutes):\n${link}\n\nIgnore this if you didn't ask. Your password stays the same.`,
        html: `<p>Someone asked to reset the password for your Minutely account.</p><p><a href="${link}">Reset your password</a></p><p>This link expires in 30 minutes.</p><p>Ignore this if you didn't ask. Your password stays the same.</p>`,
      });
    }
  } catch (error) {
    // Same answer on failure too; never reveal anything about the account.
    console.error("Forgot password error:", error instanceof Error ? error.message : "unknown");
  }
  return Response.json(SAME_ANSWER);
}
