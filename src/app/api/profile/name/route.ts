import { getUserId, unauthorized } from "@/lib/auth";
import { cleanDisplayName } from "@/lib/polishCore";
import { readDisplayName, saveDisplayName } from "@/lib/polishDb";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** The name used for "You" in speaker labels. "You" until the owner has run the database update. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    return Response.json(await readDisplayName(userId), { headers: NO_STORE });
  } catch (err) {
    console.error("Display name read error:", err);
    return Response.json({ error: "Couldn't load your name. Try again." }, { status: 503, headers: NO_STORE });
  }
}

export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const clean = cleanDisplayName(body?.name);
  if (!clean.ok) return Response.json({ error: clean.error }, { status: 400, headers: NO_STORE });
  try {
    if (!(await saveDisplayName(userId, clean.name))) {
      return Response.json({ error: "Your name needs a database update. Try again later." }, { status: 503, headers: NO_STORE });
    }
    return Response.json(await readDisplayName(userId), { headers: NO_STORE });
  } catch (err) {
    console.error("Display name save error:", err);
    return Response.json({ error: "Couldn't save your name. Try again." }, { status: 503, headers: NO_STORE });
  }
}
