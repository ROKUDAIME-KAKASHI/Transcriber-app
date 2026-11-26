import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_INIT_SCRIPT, THEME_KEY, parseTheme, resolveTheme, toggleTheme } from "../src/lib/theme.ts";

test("only light and dark are explicit choices", () => {
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  for (const v of ["system", "", "DARK", null, undefined, 1]) assert.equal(parseTheme(v), "system");
});

test("system follows the OS, explicit choices ignore it", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("quick toggle flips what is shown now", () => {
  assert.equal(toggleTheme("system", true), "light");
  assert.equal(toggleTheme("system", false), "dark");
  assert.equal(toggleTheme("dark", false), "light");
  assert.equal(toggleTheme("light", true), "dark");
});

function run(stored: string | null, throwing = false) {
  const attrs: Record<string, string> = {};
  const metas = [{ c: "x", setAttribute(_: string, v: string) { this.c = v; } }];
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { localStorage: g.localStorage, document: g.document };
  g.localStorage = { getItem: (k: string) => { if (throwing) throw new Error("blocked"); return k === THEME_KEY ? stored : null; } };
  g.document = {
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    querySelectorAll: () => ({ forEach: (f: (m: (typeof metas)[0]) => void) => metas.forEach(f) }),
  };
  try {
    new Function(THEME_INIT_SCRIPT)();
  } finally {
    g.localStorage = prev.localStorage;
    g.document = prev.document;
  }
  return { attrs, color: metas[0].c };
}

test("init script sets data-theme and theme-color from the saved choice", () => {
  assert.deepEqual(run("dark"), { attrs: { "data-theme": "dark" }, color: "#111827" });
  assert.deepEqual(run("light"), { attrs: { "data-theme": "light" }, color: "#f6f5f1" });
});

test("init script leaves system alone and never throws", () => {
  assert.deepEqual(run(null), { attrs: {}, color: "x" });
  assert.deepEqual(run("purple"), { attrs: {}, color: "x" });
  assert.deepEqual(run("dark", true), { attrs: {}, color: "x" });
});
