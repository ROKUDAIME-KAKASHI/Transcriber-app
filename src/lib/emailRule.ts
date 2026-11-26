/** Sign-up and login accept only these domains. Not used for People, booking guests or attendees. */
export const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "jainuniversity.ac.in"] as const;

export const EMAIL_DOMAIN_MESSAGE = "Use your @gmail.com or @jainuniversity.ac.in email.";

/** True when the address (trimmed, any case) has exactly one @ and its whole domain is an allowed one. */
export function isAllowedEmailDomain(email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at !== e.indexOf("@")) return false;
  const domain = e.slice(at + 1);
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}
