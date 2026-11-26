/** Plain-words lines for the Record screen. No imports, so node:test can load them. */

export type SummaryEngine = "moonshine" | "whisper" | "deepgram";

/** One line shown on the collapsed Settings row, e.g. "On this device · English". */
export function settingsSummary(engine: SummaryEngine, languageLabel: string): string {
  return `${engine === "deepgram" ? "Cloud" : "On this device"} · ${languageLabel}`;
}

/** Where the audio goes, by engine. Shown under the record button. */
export function privacyNote(engine: SummaryEngine): string {
  return engine === "deepgram" ? "Sent securely to the cloud to transcribe" : "Stays on this device until you save";
}
