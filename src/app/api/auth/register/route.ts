import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters long"),
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
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 }
      );
    }
    const password = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({ data: { email, password } });
    return Response.json({ userId: user.id }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return Response.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }
}
