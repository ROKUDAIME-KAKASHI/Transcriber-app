import { getFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";

/** Public: which features are switched on. No secrets; cached for a minute at the edge and in the browser. */
export async function GET() {
  const flags = await getFlags();
  return Response.json(flags, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
