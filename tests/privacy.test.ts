import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_DELETE_ORDER,
  CONSENT_NOTE,
  consentDetail,
  isAccountLocalKey,
  isDeleteConfirmed,
} from "../src/lib/privacyCore.ts";

test("delete: children go before the rows they point at, the user last", () => {
  const at = (s: (typeof ACCOUNT_DELETE_ORDER)[number]) => ACCOUNT_DELETE_ORDER.indexOf(s);
  const pairs: [(typeof ACCOUNT_DELETE_ORDER)[number], (typeof ACCOUNT_DELETE_ORDER)[number]][] = [
    ["actionItemEvent", "actionItem"],
    ["actionItem", "meeting"],
    ["planReference", "plannedMeeting"],
    ["plannedAttendee", "plannedMeeting"],
    ["plannedMeeting", "meetingSeries"],
    ["booking", "eventType"],
  ];
  for (const [child, parent] of pairs) assert.ok(at(child) >= 0 && at(child) < at(parent), `${child} before ${parent}`);
  assert.equal(ACCOUNT_DELETE_ORDER[ACCOUNT_DELETE_ORDER.length - 1], "user");
  assert.equal(new Set(ACCOUNT_DELETE_ORDER).size, ACCOUNT_DELETE_ORDER.length);
  assert.ok(ACCOUNT_DELETE_ORDER.includes("clientError"), "the log has no foreign key, so it is deleted explicitly");
  assert.ok(!(ACCOUNT_DELETE_ORDER as readonly string[]).includes("featureFlag"), "flags are global");
});

test("delete needs the exact word", () => {
  assert.equal(isDeleteConfirmed("DELETE"), true);
  assert.equal(isDeleteConfirmed("  DELETE "), true);
  assert.equal(isDeleteConfirmed("delete"), false);
  assert.equal(isDeleteConfirmed("DELETE ALL"), false);
  assert.equal(isDeleteConfirmed(""), false);
  assert.equal(isDeleteConfirmed(undefined), false);
});

test("local keys: this account's data goes, device settings and other accounts stay", () => {
  assert.equal(isAccountLocalKey("minutely.displayName", "u1"), true);
  assert.equal(isAccountLocalKey("transcriber.lastUserId", "u1"), true);
  assert.equal(isAccountLocalKey("minutely.extras.u1.m9", "u1"), true);
  assert.equal(isAccountLocalKey("minutely.ask.u1.m9", "u1"), true);
  assert.equal(isAccountLocalKey("minutely.extras.u2.m9", "u1"), false);
  assert.equal(isAccountLocalKey("minutely.recordingConsent", "u1"), false);
  assert.equal(isAccountLocalKey("transcriber.engine", "u1"), false);
  assert.equal(isAccountLocalKey("minutely.extras.u1.m9", ""), false);
});

test("consent wording matches what each engine does", () => {
  assert.match(CONSENT_NOTE, /transcribed with Minutely/);
  assert.match(consentDetail("deepgram"), /Deepgram/);
  assert.match(consentDetail("moonshine"), /stays on this device/);
  assert.equal(consentDetail("whisper"), consentDetail("moonshine"));
  assert.doesNotMatch(consentDetail("moonshine"), /Deepgram/);
});
