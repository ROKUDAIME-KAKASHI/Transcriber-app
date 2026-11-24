import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyToken } from "./adminAuthCore";

export { ADMIN_COOKIE };

/** Same secret NextAuth uses (src/lib/auth.ts), with AUTH_SECRET as a fallback. */
export const adminSecret = (): string | undefined => process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || undefined;

export const adminConfigured = (): boolean => Boolean(process.env.ADMIN_PASSWORD_HASH) && Boolean(adminSecret());

/** True when the request carries a valid, unexpired tr_admin cookie. */
export async function isAdminAuthed(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const jar = await cookies();
  return verifyToken(jar.get(ADMIN_COOKIE)?.value, adminSecret());
}
