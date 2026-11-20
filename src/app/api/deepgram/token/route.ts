import { getUserId, unauthorized } from "@/lib/auth";

/**
 * Mints a short-lived Deepgram token for a signed-in user.
 *
 * The real API key never leaves the server. Anyone can sign up for this app, so handing out
 * the key (even "only to signed-in users") would let anyone copy it and run up the bill.
 * The token only has to be valid when the WebSocket opens; the stream stays up after it expires.
 *
 * If Deepgram answers 401/403, the key's role is too low: create a key with the Member role
 * (or higher) in the Deepgram console.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Cloud transcription isn't set up on this server (DEEPGRAM_API_KEY is missing)." },
      { status: 500 }
    );
  }

  let res: Response;
  try {
    res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("Deepgram token request failed (network):", err);
    return Response.json({ error: "Could not reach Deepgram. Check your connection and try again." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Deepgram token error:", res.status, detail);
    const error =
      res.status === 401 || res.status === 403
        ? "Server misconfigured: the Deepgram API key is invalid or needs the Member role (or higher)."
        : "Could not get a Deepgram token.";
    return Response.json({ error }, { status: 502 });
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return Response.json(
    { token: data.access_token, expiresIn: data.expires_in },
    { headers: { "Cache-Control": "no-store" } }
  );
}
