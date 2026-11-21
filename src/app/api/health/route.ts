// Reachability probe: no auth, no database (must not wake Neon).
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
