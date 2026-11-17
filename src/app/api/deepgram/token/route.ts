import { getUserId, unauthorized } from "@/lib/auth";

/**
 * Mints a short-lived Deepgram token for a signed-in user.
 * The real API key never leaves the server (the Life OS version shipped it
 * to the browser via NEXT_PUBLIC_DEEPGRAM_API_KEY, which is unsafe for a public app).
 * The token only has to be valid when the WebSocket opens; the stream stays up after it expires.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "DEEPGRAM_API_KEY is not set on the server." }, { status: 500 });
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 60 }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("Deepgram token error:", res.status, await res.text().catch(() => ""));
    return Response.json({ error: "Could not get a Deepgram token." }, { status: 502 });
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return Response.json(
    { token: data.access_token, expiresIn: data.expires_in },
    { headers: { "Cache-Control": "no-store" } }
  );
}
