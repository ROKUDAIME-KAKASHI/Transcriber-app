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
      // The link's origin comes from server config. The request's own origin is used only when it is one of
      // this app's known hosts, so a forged Host header can never point a real reset link at another site.
      const PROD_ORIGIN = "https://transcriber-app-ten.vercel.app";
      let origin = PROD_ORIGIN;
      try {
        if (process.env.NEXTAUTH_URL) origin = new URL(process.env.NEXTAUTH_URL).origin;
        else {
          const u = new URL(req.url);
          const known =
            u.hostname === "localhost" || u.hostname === "127.0.0.1" ||
            (u.protocol === "https:" && /^transcriber-app-[a-z0-9-]+\.vercel\.app$/.test(u.hostname));
          if (known) origin = u.origin;
        }
      } catch {
        origin = PROD_ORIGIN;
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
