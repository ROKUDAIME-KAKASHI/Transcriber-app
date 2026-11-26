// Fails when any route's first-load JavaScript is over the budget. Run after `npm run build`.
// Reads .next/diagnostics/route-bundle-stats.json (written by `next build`, uncompressed bytes).
import fs from "node:fs";
import path from "node:path";

// Largest route when this was set: /meetings at 1,576,304 bytes. Budget = that + 15%, rounded up.
// Raise it on purpose (and say why in the commit) when a real feature needs more.
const BUDGET_BYTES = 1_820_000;

const file = path.resolve(import.meta.dirname, "..", ".next", "diagnostics", "route-bundle-stats.json");
if (!fs.existsSync(file)) {
  console.error("FAIL: .next/diagnostics/route-bundle-stats.json not found. Run `npm run build` first.");
  process.exit(1);
}
const stats = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = stats
  .map((r) => ({ route: r.route, bytes: Number(r.firstLoadUncompressedJsBytes) || 0 }))
  .sort((a, b) => b.bytes - a.bytes);
if (!rows.length) {
  console.error("FAIL: no routes in the bundle stats.");
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`First-load JS, top 5 of ${rows.length} routes (budget ${kb(BUDGET_BYTES)} each):`);
for (const r of rows.slice(0, 5)) console.log(`  ${r.bytes > BUDGET_BYTES ? "OVER" : "ok  "} ${r.route.padEnd(16)} ${kb(r.bytes)}`);

const over = rows.filter((r) => r.bytes > BUDGET_BYTES);
if (over.length) {
  console.error(`\nFAIL: ${over.length} route(s) over budget: ${over.map((r) => r.route).join(", ")}`);
  process.exit(1);
}
console.log("PASS: every route is within budget");
