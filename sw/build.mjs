// Generates public/sw.js from sw/sw.template.js after `next build` (called from next.config.ts).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectPrecache, makeVersion } = require("./manifest.js");

const MAX_CRITICAL_BYTES = 6 * 1024 * 1024;
const SHELLS = ["/", "/meetings", "/meeting", "/tasks", "/people", "/plan", "/schedule", "/profile", "/login", "/offline", "/manifest.webmanifest"];

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function shortHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
}

export async function buildServiceWorker({ projectDir, distDir }) {
  // distDir is absolute in Next 16: resolve, never join.
  const dist = path.resolve(projectDir, distDir);
  const staticDir = path.join(dist, "static");
  const rels = selectPrecache(walk(staticDir));
  let bytes = 0;
  for (const rel of rels) bytes += fs.statSync(path.join(staticDir, rel)).size;
  if (rels.length === 0) throw new Error("sw build: precache set is empty");
  if (bytes > MAX_CRITICAL_BYTES) {
    throw new Error(`sw build: critical precache is ${bytes} bytes (limit ${MAX_CRITICAL_BYTES})`);
  }
  const assets = rels.map((r) => "/_next/static/" + r);

  const lazy = [];
  for (const name of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
    const f = path.join(projectDir, "public", "ort", name);
    if (fs.existsSync(f)) lazy.push({ url: "/ort/" + name, rev: shortHash(f) });
  }

  const version = makeVersion(assets, lazy.map((l) => l.url + "@" + l.rev), Date.now());
  const manifest = { version, assets, shells: SHELLS, lazy };

  const template = fs.readFileSync(path.join(projectDir, "sw", "sw.template.js"), "utf8");
  const routing = fs.readFileSync(path.join(projectDir, "sw", "routing.js"), "utf8");
  const out = template
    .replace("/*__ROUTING__*/", () => routing)
    .replace("/*__MANIFEST__*/", () => "var MANIFEST = " + JSON.stringify(manifest) + ";");
  fs.writeFileSync(path.join(projectDir, "public", "sw.js"), out);
  console.log(`[sw] public/sw.js written: ${assets.length} assets, ${(bytes / 1024).toFixed(0)} KB critical, version ${version}`);
}
