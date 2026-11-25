// Builds and publishes a new Android APK.
//
//   node scripts/release-apk.mjs <versionName> "<release notes>" [--dry-run]
//
// 1. bumps versionCode (+1) and versionName in android/app/build.gradle AND src/lib/appRelease.ts together
// 2. npx cap sync android with CAP_SERVER_URL pointing at the live site
// 3. gradlew assembleRelease (needs android/keystore.properties for a signed APK)
// 4. copies the APK to public/downloads/Minutely.apk and dist/Minutely.apk
//
// If any step fails the two version files are put back as they were.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bumpAppRelease, bumpGradle, planRelease, readAppRelease, readGradleVersion } from "./releaseCore.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_URL = "https://transcriber-app-ten.vercel.app";
const gradleFile = path.join(root, "android", "app", "build.gradle");
const releaseFile = path.join(root, "src", "lib", "appRelease.ts");
const builtApk = path.join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [versionName, notes] = args.filter((a) => a !== "--dry-run");

function fail(msg) {
  console.error(`release-apk: ${msg}`);
  process.exit(1);
}

if (!versionName || !notes) fail('usage: node scripts/release-apk.mjs <versionName> "<release notes>" [--dry-run]');

const gradleOrig = fs.readFileSync(gradleFile, "utf8");
const releaseOrig = fs.readFileSync(releaseFile, "utf8");
const g = readGradleVersion(gradleOrig);
const r = readAppRelease(releaseOrig);
if (g.versionCode !== r.versionCode || g.versionName !== r.versionName) {
  fail(`build.gradle (${g.versionCode} / ${g.versionName}) and appRelease.ts (${r.versionCode} / ${r.versionName}) disagree. Fix that first.`);
}

let plan;
try {
  plan = planRelease(g, versionName, notes);
} catch (e) {
  fail(e.message);
}
console.log(`release-apk: ${g.versionName} (${g.versionCode}) -> ${plan.versionName} (${plan.versionCode})`);
if (dryRun) {
  console.log("release-apk: dry run, nothing written.");
  process.exit(0);
}

if (!fs.existsSync(path.join(root, "android", "keystore.properties"))) {
  fail("android/keystore.properties is missing, so the APK would be unsigned. Aborting before changing anything.");
}

function restore() {
  fs.writeFileSync(gradleFile, gradleOrig);
  fs.writeFileSync(releaseFile, releaseOrig);
  console.error("release-apk: version files restored to their previous values.");
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) {
    restore();
    fail(`${cmd} failed (exit ${res.status}).`);
  }
}

fs.writeFileSync(gradleFile, bumpGradle(gradleOrig, plan.versionCode, plan.versionName));
fs.writeFileSync(releaseFile, bumpAppRelease(releaseOrig, plan.versionCode, plan.versionName, plan.notes));

run("npx", ["cap", "sync", "android"], { cwd: root, env: { ...process.env, CAP_SERVER_URL: SERVER_URL } });
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
run(gradlew, ["assembleRelease"], { cwd: path.join(root, "android") });

if (!fs.existsSync(builtApk)) {
  restore();
  fail(`expected APK not found at ${builtApk}`);
}
const targets = [path.join(root, "public", "downloads", "Minutely.apk"), path.join(root, "dist", "Minutely.apk")];
for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.copyFileSync(builtApk, t);
  console.log(`release-apk: wrote ${path.relative(root, t)}`);
}
console.log(`release-apk: done. Commit android/app/build.gradle, src/lib/appRelease.ts and public/downloads/Minutely.apk on a branch, then follow .planning/RELEASE.md.`);
