import { MEETING_ID_RE } from "./meetingId.ts";

/** Validated meeting id from ?id= (wins) or a /meetings/<id> pathname; null when absent or invalid. */
export function resolveMeetingId(search: string, pathname: string): string | null {
  const q = new URLSearchParams(search).get("id");
  if (q !== null) return MEETING_ID_RE.test(q) ? q : null;
  const m = /^\/meetings\/([^/]+)\/?$/.exec(pathname);
  if (m && MEETING_ID_RE.test(m[1])) return m[1];
  return null;
}
