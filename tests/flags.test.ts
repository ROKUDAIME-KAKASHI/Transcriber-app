import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FLAG_DEFAULTS, FLAG_KEYS, defaultFlags, isFlagKey, mergeFlags, parseFlags } from "../src/lib/flagsCore.ts";

describe("flagsCore", () => {
  test("every flag defaults to on", () => {
    for (const k of FLAG_KEYS) assert.equal(FLAG_DEFAULTS[k], true);
    for (const k of ["actionItems", "taskTracker", "followUpAgenda", "scheduling", "nameSuggestions", "offlineLockedRecording"]) {
      assert.ok(isFlagKey(k), k);
    }
  });

  test("missing table / no rows gives defaults", () => {
    assert.deepEqual(mergeFlags(null), defaultFlags());
    assert.deepEqual(mergeFlags([]), defaultFlags());
  });

  test("rows override defaults; unknown keys and non-booleans are ignored", () => {
    const f = mergeFlags([
      { key: "scheduling", enabled: false },
      { key: "nope", enabled: false },
      { key: "taskTracker", enabled: "no" },
    ]);
    assert.equal(f.scheduling, false);
    assert.equal(f.taskTracker, true);
    assert.equal((f as Record<string, unknown>).nope, undefined);
  });

  test("defaultFlags returns a fresh object", () => {
    const a = defaultFlags();
    a.actionItems = false;
    assert.equal(defaultFlags().actionItems, true);
  });

  test("parseFlags survives junk", () => {
    assert.deepEqual(parseFlags(null), defaultFlags());
    assert.deepEqual(parseFlags("x"), defaultFlags());
    assert.equal(parseFlags({ nameSuggestions: false }).nameSuggestions, false);
    assert.equal(parseFlags({ nameSuggestions: 0 }).nameSuggestions, true);
  });
});
