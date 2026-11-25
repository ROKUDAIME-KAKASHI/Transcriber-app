// Pure helpers for scripts/release-apk.mjs (no I/O, so node:test can load them).

export const VERSION_NAME_RE = /^\d+\.\d+(\.\d+)?$/;

/** Reads versionCode and versionName from android/app/build.gradle text. */
export function readGradleVersion(gradle) {
  const code = /^\s*versionCode\s+(\d+)\s*$/m.exec(gradle);
  const name = /^\s*versionName\s+"([^"]+)"\s*$/m.exec(gradle);
  if (!code || !name) throw new Error("Could not find versionCode / versionName in build.gradle");
  return { versionCode: Number(code[1]), versionName: name[1] };
}

/** Returns build.gradle text with the new versionCode and versionName. */
export function bumpGradle(gradle, versionCode, versionName) {
  readGradleVersion(gradle); // throws if the lines are missing
  return gradle
    .replace(/^(\s*versionCode\s+)\d+(\s*)$/m, (_m, a, b) => `${a}${versionCode}${b}`)
    .replace(/^(\s*versionName\s+)"[^"]+"(\s*)$/m, (_m, a, b) => `${a}"${versionName}"${b}`);
}

/** Reads the LATEST_APK values from src/lib/appRelease.ts text. */
export function readAppRelease(ts) {
  const code = /versionCode:\s*(\d+)/.exec(ts);
  const name = /versionName:\s*"([^"]+)"/.exec(ts);
  if (!code || !name) throw new Error("Could not find versionCode / versionName in appRelease.ts");
  return { versionCode: Number(code[1]), versionName: name[1] };
}

/** Returns appRelease.ts text with the new version and release notes. */
export function bumpAppRelease(ts, versionCode, versionName, notes) {
  readAppRelease(ts);
  return ts
    .replace(/(versionCode:\s*)\d+/, (_m, a) => `${a}${versionCode}`)
    .replace(/(versionName:\s*)"[^"]+"/, (_m, a) => `${a}${JSON.stringify(versionName)}`)
    .replace(/(notes:\s*)"(?:[^"\\]|\\.)*"/, (_m, a) => `${a}${JSON.stringify(notes)}`);
}

/** Validates the requested version against the current one. Returns the next versionCode. */
export function planRelease(current, versionName, notes) {
  if (!VERSION_NAME_RE.test(versionName || "")) throw new Error(`Version name "${versionName}" must look like 1.3 or 1.3.1`);
  if (versionName === current.versionName) throw new Error(`Version ${versionName} is already the current version name`);
  if (!notes || !notes.trim()) throw new Error("Release notes are required (second argument)");
  return { versionCode: current.versionCode + 1, versionName, notes: notes.trim().slice(0, 400) };
}
