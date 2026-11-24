import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

/** Extract the body of the first block that starts at `marker` (brace matched). */
function blockAfter(marker: string, from = 0): string {
  const start = css.indexOf(marker, from);
  assert.ok(start >= 0, `missing ${marker}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

function hexTokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const light = hexTokens(blockAfter(":root {"));
const mediaIdx = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = hexTokens(blockAfter(":root {", mediaIdx));

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const themes: Array<[string, Record<string, string>]> = [
  ["light", light],
  ["dark", dark],
];

function check(t: Record<string, string>, fg: string, bg: string, min: number, name: string) {
  const f = fg.startsWith("#") ? fg : t[fg];
  const b = bg.startsWith("#") ? bg : t[bg];
  assert.ok(f && b, `${name}: missing token ${fg}/${bg}`);
  const r = ratio(f, b);
  assert.ok(r >= min, `${name}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
}

test("background tokens are the tinted Aurora Ink values", () => {
  assert.equal(light.background, "#f7f7fb");
  assert.equal(dark.background, "#0e0f17");
});

for (const [name, t] of themes) {
  test(`${name}: foreground and muted text pass AA`, () => {
    check(t, "foreground", "background", 4.5, name);
    check(t, "foreground", "card", 4.5, name);
    for (const bg of ["background", "card", "muted"]) check(t, "muted-foreground", bg, 4.5, name);
  });

  test(`${name}: accent pairs pass AA`, () => {
    check(t, "accent-foreground", "accent", 4.5, name);
    check(t, "accent", "background", 4.5, name);
    check(t, "accent", "card", 4.5, name);
  });

  test(`${name}: status colours pass AA`, () => {
    for (const c of ["danger", "success", "warning"]) {
      check(t, c, "card", 4.5, name);
      check(t, c, "background", 4.5, name);
    }
  });

  test(`${name}: record text passes AA`, () => {
    check(t, "record", "card", 4.5, name);
    check(t, "record", "background", 4.5, name);
    check(t, "record", "muted", 4.5, name);
  });

  test(`${name}: speaker colours pass AA on card`, () => {
    for (let i = 0; i < 6; i++) check(t, `speaker-${i}`, "card", 4.5, name);
  });

  test(`${name}: record fill carries white glyph`, () => {
    check(t, "#ffffff", "record-fill", 3, name);
  });
}

test("dark: record fill is distinguishable from background", () => {
  check(dark, "record-fill", "background", 3, "dark");
});

/** Composite a token at `alpha` over a backdrop token (Tailwind `bg-muted-foreground/75` etc). */
function blend(fg: string, bg: string, alpha: number): string {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const ch = (shift: number) => Math.round(((f >> shift) & 255) * alpha + ((b >> shift) & 255) * (1 - alpha));
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
}

for (const [name, t] of themes) {
  test(`${name}: switch off-track and radio ring (muted-foreground/75) are >= 3:1 on card`, () => {
    check(t, blend(t["muted-foreground"], t.card, 0.75), "card", 3, name);
  });
}
