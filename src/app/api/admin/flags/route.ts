import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { isAdminAuthed } from "@/lib/adminAuth";
import { clearFlagsCache } from "@/lib/flags";
import { FLAG_KEYS } from "@/lib/flagsCore";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/serverLog";

export const dynamic = "force-dynamic";

const Body = z.object({ key: z.enum(FLAG_KEYS as [string, ...string[]]), enabled: z.boolean() });

/** Turn one feature on or off. Admin cookie required. */
export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  const { key, enabled } = parsed.data;
  try {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
    clearFlagsCache();
    return NextResponse.json({ ok: true, key, enabled }, { headers });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return NextResponse.json({ error: "Feature switches need a database update (see .planning/DB-MIGRATIONS.md)" }, { status: 503, headers });
    }
    logServerError("POST /api/admin/flags", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500, headers });
  }
}
