import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { loadAdminData } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  return NextResponse.json(await loadAdminData(), { headers });
}
