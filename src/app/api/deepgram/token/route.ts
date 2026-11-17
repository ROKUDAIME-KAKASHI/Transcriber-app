import { getUserId, unauthorized } from "@/lib/auth";

/**
 * Mints a short-lived Deepgram token for a signed-in user.
 * If the key lacks permission to call /v1/auth/grant (e.g. non-admin project keys return 403),
 * it falls back to providing the key with subprotocol "token" to authenticated users.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "DEEPGRAM_API_KEY is not set on the server." }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });

    if (res.ok) {
      const data = (await res.json()) as { access_token: string; expires_in: number };
      return Response.json(
        { token: data.access_token, subprotocol: "bearer", expiresIn: data.expires_in },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch (err) {
    console.warn("Deepgram /v1/auth/grant failed, falling back to direct token:", err);
  }

  // Fallback: direct token authentication for signed-in user
  return Response.json(
    { token: apiKey, subprotocol: "token" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
