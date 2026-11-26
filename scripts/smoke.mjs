// Smoke test for a finished build: node scripts/smoke.mjs (run `npm run build` first).
// Starts `next start` on a free port and checks public and signed-in routes never answer 500.
// Needs no database: routes that read it may answer a graceful 503 instead.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;

let log = "";
const server = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: root,
  // A dead local database URL: the smoke test must never reach a real database, even if .env points at one.
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=2",
    DATABASE_URL_UNPOOLED: "postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=2",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "smoke-placeholder-secret-0000000000000",
    NEXTAUTH_URL: "http://127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
let exited = false;
server.on("exit", () => (exited = true));

const get = (p, init = {}) => fetch(base + p, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error("next start exited early:\n" + log.slice(-1500));
    try {
      await get("/login");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("server did not start in 60s");
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? " - " + detail : ""}`);
  if (!ok) failed++;
}
const isRedirect = (s) => s >= 300 && s < 400;

try {
  await waitReady();

  // Public routes.
  const login = await get("/login");
  check("/login answers 200", login.status === 200, String(login.status));
  check("/login has COOP same-origin", login.headers.get("cross-origin-opener-policy") === "same-origin", String(login.headers.get("cross-origin-opener-policy")));
  check("/login has COEP require-corp", login.headers.get("cross-origin-embedder-policy") === "require-corp", String(login.headers.get("cross-origin-embedder-policy")));

  const book = await get("/book/does-not-exist-smoke");
  // 404 with a database; without one the page shows its own "couldn't load" notice (200) or a 503. Never a 500.
  check("/book/<nonexistent> is 404, or graceful without a database", [404, 503, 200].includes(book.status), String(book.status));

  const hasApk = fs.existsSync(path.join(root, "public", "downloads", "Minutely.apk"));
  const apk = await get("/downloads/Minutely.apk", { method: "HEAD" });
  check(
    "/downloads/Minutely.apk redirects or serves",
    apk.status === 200 || isRedirect(apk.status) || (!hasApk && apk.status === 404),
    String(apk.status)
  );

  const flags = await get("/api/flags");
  check("/api/flags answers 200 (or a graceful 503 without a database)", flags.status === 200 || flags.status === 503, String(flags.status));

  // Signed-in routes with no session: a redirect to login or a 401, never a 500.
  for (const p of ["/api/meetings", "/api/meetings/smoke-id", "/api/meetings/smoke-id/summary", "/api/profile/name", "/api/action-items"]) {
    const r = await get(p);
    check(`${p} without a session is 401 or a redirect`, r.status === 401 || isRedirect(r.status), String(r.status));
  }
  for (const p of ["/meetings", "/profile", "/tasks"]) {
    const r = await get(p);
    check(`${p} without a session is not a server error`, r.status < 500, String(r.status));
  }
} catch (e) {
  check("smoke run", false, e instanceof Error ? e.message : String(e));
} finally {
  server.kill();
}

if (failed) {
  console.error(`\n${failed} smoke check(s) failed.\n--- server log (tail) ---\n${log.slice(-1500)}`);
  process.exit(1);
}
console.log("\nSmoke OK");
