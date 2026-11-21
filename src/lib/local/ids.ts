/** Client-generated meeting id. randomUUID needs a secure context, so fall back to getRandomValues. */
export function newMeetingId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(12);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidMeetingId(id: string): boolean {
  return /^[a-z0-9_-]{16,40}$/.test(id);
}
