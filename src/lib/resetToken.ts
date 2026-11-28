// Stateless password-reset tokens (node:crypto only, so they can be unit tested). No table needed.
// Token = base64url(JSON{uid, exp, ph}) + "." + HMAC-SHA256. `ph` fingerprints the user's current password hash,
// so once the password changes every older link stops verifying.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const RESET_TTL_MS = 30 * 60 * 1000;
export const RESET_INVALID = "This link has expired or was already used. Ask for a new one.";
const KEY_LABEL = "transcriber-password-reset-v1";

export interface ResetPayload {
  uid: string;
  exp: number;
  ph: string;
}

const key = (secret: string) => createHmac("sha256", secret).update(KEY_LABEL).digest();
const mac = (payload: string, secret: string) => createHmac("sha256", key(secret)).update(payload).digest("base64url");

/** First 16 base64url chars of sha256(password hash). */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

export function signResetToken(uid: string, passwordHash: string, secret: string, now = Date.now()): string {
  const body: ResetPayload = { uid, exp: now + RESET_TTL_MS, ph: passwordFingerprint(passwordHash) };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** Signature and expiry only. The caller still has to compare `ph` with the user's current hash. Never throws. */
export function verifyResetToken(token: string | undefined, secret: string | undefined, now = Date.now()): ResetPayload | null {
  if (!token || !secret) return null;
  try {
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(mac(payload, secret));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof p?.uid !== "string" || typeof p?.ph !== "string" || typeof p?.exp !== "number" || now >= p.exp) return null;
    return { uid: p.uid, exp: p.exp, ph: p.ph };
  } catch {
    return null;
  }
}

/** True when the token was issued for the user's current password hash (constant time). */
export function matchesPassword(p: ResetPayload, currentHash: string): boolean {
  const a = Buffer.from(p.ph);
  const b = Buffer.from(passwordFingerprint(currentHash));
  return a.length === b.length && timingSafeEqual(a, b);
}
