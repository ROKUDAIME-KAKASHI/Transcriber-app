// Pure admin-auth helpers (node:crypto only) so they can be unit tested.
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "tr_admin";
export const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
const KEY_LABEL = "transcriber-admin-session-v1";

/** Verify a password against `scrypt$N$r$p$<salt b64url>$<hash b64url>`. Never throws. */
export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length === 0 || expected.length !== 64) return false;
    const actual = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const sessionKey = (secret: string) => createHmac("sha256", secret).update(KEY_LABEL).digest();
const sign = (payload: string, secret: string) => createHmac("sha256", sessionKey(secret)).update(payload).digest("base64url");

export function createToken(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ADMIN_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!token || !secret) return false;
  try {
    const [payload, mac, extra] = token.split(".");
    if (!payload || !mac || extra !== undefined) return false;
    const a = Buffer.from(mac);
    const b = Buffer.from(sign(payload, secret));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const { iat, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof iat === "number" && typeof exp === "number" && iat <= now + 60_000 && now < exp;
  } catch {
    return false;
  }
}

/** Simple in-memory limiter: `max` failures per `windowMs` per key. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max = 5, windowMs = 15 * 60 * 1000) {
    this.max = max;
    this.windowMs = windowMs;
  }
  private recent(key: string, now: number) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }
  fail(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
  }
  clear(key: string): void {
    this.hits.delete(key);
  }
}
