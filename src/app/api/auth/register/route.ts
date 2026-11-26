import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { EMAIL_DOMAIN_MESSAGE, isAllowedEmailDomain } from "@/lib/emailRule";
import { passwordProblem } from "@/lib/passwordRule";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Email and password are required" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase().trim();
  if (!isAllowedEmailDomain(email)) return Response.json({ error: EMAIL_DOMAIN_MESSAGE }, { status: 400 });
  const weak = passwordProblem(parsed.data.password);
  if (weak) return Response.json({ error: weak }, { status: 400 });
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return Response.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 }
      );
    }
    const password = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({ data: { email, password }, select: { id: true } });
    return Response.json({ userId: user.id }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return Response.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }
}
