// Post-build assertions on the generated service worker and prerendered shells.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectPrecache } = require("../sw/manifest.js");
const root = path.resolve(import.meta.dirname, "..");

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? " - " + detail : ""}`);
  if (!ok) failed++;
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

const swPath = path.join(root, "public", "sw.js");
const haveSw = fs.existsSync(swPath);
check("1 public/sw.js exists", haveSw);
const sw = haveSw ? fs.readFileSync(swPath, "utf8") : "";

const staticDir = path.join(root, ".next", "static");
const expected = selectPrecache(walk(staticDir)).filter((r) => r.startsWith("chunks/"));
const missing = expected.filter((r) => !sw.includes("/_next/static/" + r));
check("2 every build chunk is in sw.js", haveSw && expected.length > 0 && missing.length === 0, `${missing.length} missing of ${expected.length}`);

check("3 no asyncify / map / webgpu strings", haveSw && !/asyncify/.test(sw) && !/\.map["']/.test(sw) && !/webgpu/i.test(sw));

const skips = [...sw.matchAll(/skipWaiting/g)];
const sk = sw.indexOf("SKIP_WAITING");
check("4 single skipWaiting inside SKIP_WAITING branch", skips.length === 1 && sk !== -1 && skips[0].index > sk && skips[0].index - sk < 200);

check("5 COOP and COEP on synthetic responses", sw.includes("Cross-Origin-Opener-Policy") && sw.includes("Cross-Origin-Embedder-Policy"));

const appDir = path.join(root, ".next", "server", "app");
for (const name of ["index.html", "meetings.html", "meeting.html", "login.html", "offline.html"]) {
  const f = path.join(appDir, name);
  if (!fs.existsSync(f)) {
    console.log(`FAIL: 6 shell not static: ${name}`);
    failed++;
    continue;
  }
  const html = fs.readFileSync(f, "utf8");
  const bad = !html.trim() || !/<html/i.test(html) || html.includes("next-auth.session-token") || html.includes("force-dynamic");
  check(`7 shell ${name} is a clean HTML document`, !bad);
}

if (failed) {
  console.error(`check-build: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("check-build: all assertions passed");
