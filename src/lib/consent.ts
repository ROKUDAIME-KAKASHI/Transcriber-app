"use client";

/** "I'll tell them" is remembered per device, so the first-recording dialog shows once. */
const KEY = "minutely.recordingConsent";

export function hasConsented(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setConsented(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage blocked: the dialog will simply show again */
  }
}
