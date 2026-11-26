import { test } from "node:test";
import assert from "node:assert/strict";
import { privacyNote, settingsSummary } from "../src/lib/recordSummary.ts";

test("settings summary names where it runs and the language", () => {
  assert.equal(settingsSummary("moonshine", "English"), "On this device · English");
  assert.equal(settingsSummary("whisper", "Hindi"), "On this device · Hindi");
  assert.equal(settingsSummary("deepgram", "English"), "Cloud · English");
});

test("privacy note follows the engine", () => {
  assert.equal(privacyNote("moonshine"), "Stays on this device until you save");
  assert.equal(privacyNote("whisper"), "Stays on this device until you save");
  assert.equal(privacyNote("deepgram"), "Sent securely to the cloud to transcribe");
});
