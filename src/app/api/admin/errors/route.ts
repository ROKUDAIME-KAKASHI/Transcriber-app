import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { isErrorLogMissing } from "@/lib/errorLogDb";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/serverLog";

export const dynamic = "force-dynamic";

/** Clear the whole error log. Admin cookie required. */
export async function DELETE() {
  const headers = { "Cache-Control": "no-store" };
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const r = await prisma.clientError.deleteMany({});
    return NextResponse.json({ ok: true, deleted: r.count }, { headers });
  } catch (err) {
    if (isErrorLogMissing(err)) return NextResponse.json({ ok: true, deleted: 0 }, { headers });
    logServerError("DELETE /api/admin/errors", err);
    return NextResponse.json({ error: "Could not clear the log" }, { status: 500, headers });
  }
}
