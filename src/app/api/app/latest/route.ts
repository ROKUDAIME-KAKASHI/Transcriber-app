import { LATEST_APK } from "@/lib/appRelease";

export const dynamic = "force-dynamic";

/** Newest installable APK. Public and uncached so a long-open app sees new releases without a reload. */
export function GET() {
  return Response.json(LATEST_APK, { headers: { "Cache-Control": "no-store" } });
}
