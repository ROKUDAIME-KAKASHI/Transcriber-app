import { getUserId, unauthorized } from "@/lib/auth";
import { readSummary } from "@/lib/polishDb";

export const dynamic = "force-dynamic";

/** The saved summary, or null (none yet, or the database update is not applied: the device copy is used then). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    return Response.json({ summary: await readSummary(id, userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Summary read error:", err);
    return Response.json({ summary: null }, { status: 503 });
  }
}
