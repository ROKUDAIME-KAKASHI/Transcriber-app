/** Sign-up password rules. Login never checks strength, so older passwords keep working. */
export interface PasswordCheck {
  id: "length" | "letter" | "number";
  label: string;
  ok: boolean;
}

export function checkPassword(pw: string): PasswordCheck[] {
  const p = String(pw ?? "");
  return [
    { id: "length", label: "At least 8 characters", ok: p.length >= 8 },
    { id: "letter", label: "At least 1 letter", ok: /[A-Za-z]/.test(p) },
    { id: "number", label: "At least 1 number", ok: /[0-9]/.test(p) },
  ];
}

export function isStrongPassword(pw: string): boolean {
  return checkPassword(pw).every((c) => c.ok);
}

/** First unmet rule as a sentence, or null when the password is fine. */
export function passwordProblem(pw: string): string | null {
  const bad = checkPassword(pw).find((c) => !c.ok);
  return bad ? `Password needs: ${bad.label.toLowerCase()}.` : null;
}
