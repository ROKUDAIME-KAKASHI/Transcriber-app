/** Pure pieces of the privacy basics (consent wording, delete-account rules). No imports, so node:test can load them. */

export type ConsentEngine = "moonshine" | "whisper" | "deepgram";

/** What the user can paste into a call chat or WhatsApp. */
export const CONSENT_NOTE =
  "This meeting is being transcribed with Minutely for notes. Tell me if you'd rather not be recorded.";

/** One line under the record button. */
export const RECORD_REMINDER = "Tell everyone you're recording before you start.";

/** Where the audio goes and what is saved, by engine. Matches what the code does. */
export function consentDetail(engine: ConsentEngine): string {
  return engine === "deepgram"
    ? "Minutely saves the transcript to your account. The audio is sent to Deepgram to be transcribed and Minutely does not keep it."
    : "Minutely saves the transcript to your account. The audio stays on this device and is not kept.";
}

export const DELETE_WORD = "DELETE";

/** The user must type the word exactly (spaces around it are forgiven). */
export function isDeleteConfirmed(text: unknown): boolean {
  return typeof text === "string" && text.trim() === DELETE_WORD;
}

/**
 * Tables emptied for one user, children before parents, the user last. Every one is also covered by the
 * database's own cascade; listing them keeps the delete explicit (ClientError has no foreign key, so it is
 * the one that would otherwise be left behind). FeatureFlag is global, not per user, so it is not here.
 */
export const ACCOUNT_DELETE_ORDER = [
  "actionItemEvent",
  "actionItem",
  "planReference",
  "plannedAttendee",
  "plannedMeeting",
  "meetingSeries",
  "booking",
  "eventType",
  "availability",
  "agendaDraft",
  "stakeholder",
  "meeting",
  "clientError",
  "user",
] as const;
export type AccountDeleteStep = (typeof ACCOUNT_DELETE_ORDER)[number];

/** Per-account localStorage keys that go when the account is deleted. Device settings (theme, consent) stay. */
const FIXED_KEYS = [
  "transcriber.lastUserId",
  "transcriber.lastUserEmail",
  "minutely.displayName",
  "minutely.genTimes",
  "transcriber.overdueToastDay",
];
export function isAccountLocalKey(key: string, userId: string): boolean {
  if (FIXED_KEYS.includes(key)) return true;
  return !!userId && (key.startsWith("minutely.extras.") || key.startsWith("minutely.ask.")) && key.includes(`.${userId}.`);
}
