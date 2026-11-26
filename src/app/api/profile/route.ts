import { FailureLimiter } from "@/lib/adminAuthCore";
import { deleteAccountData } from "@/lib/accountDb";
import { getUserId, unauthorized } from "@/lib/auth";
import { isDeleteConfirmed } from "@/lib/privacyCore";
import { isMissingDbError } from "@/lib/polishCore";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

// Best-effort per-instance limiter: 5 attempts an hour per account.
const limiter = new FailureLimiter(5, 60 * 60 * 1000);

/** Deletes the signed-in user's account and everything they own. The user comes from the session, never the body. */
export async function DELETE(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (limiter.blocked(userId)) {
    return Response.json({ error: "Too many tries. Try again in an hour." }, { status: 429, headers: NO_STORE });
  }
  limiter.fail(userId);
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (!isDeleteConfirmed(body?.confirm)) {
    return Response.json({ error: "Type DELETE to confirm." }, { status: 400, headers: NO_STORE });
  }
  try {
    await deleteAccountData(userId);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("Account delete error:", err);
    if (isMissingDbError(err)) {
      return Response.json({ error: "The database needs an update before your account can be deleted. Try again later." }, { status: 503, headers: NO_STORE });
    }
    return Response.json({ error: "Couldn't delete your account. Nothing was removed. Try again." }, { status: 500, headers: NO_STORE });
  }
}
