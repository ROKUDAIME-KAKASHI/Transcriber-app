// Generates the Android launcher icons from assets/icon-art.svg (run: node scripts/make-icons.mjs).
// Adaptive icon = solid background colour + foreground PNG whose art sits inside the 66dp safe zone.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const art = fs.readFileSync(path.join(root, "assets", "icon-art.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const BG = "#171926";
const res = path.join(root, "android", "app", "src", "main", "res");
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// The bubble spans ~72dp; the adaptive safe zone is 66dp, so the foreground art is scaled to 0.8.
const scaled = (s) => `<g transform="translate(54 54) scale(${s}) translate(-54 -54)">${art}</g>`;
const svg = (body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${bg ?? ""}${body}</svg>`;
const legacySquare = svg(scaled(0.92), `<rect width="108" height="108" rx="24" fill="${BG}"/>`);
const legacyRound = svg(scaled(0.84), `<circle cx="54" cy="54" r="54" fill="${BG}"/>`);
const foreground = svg(scaled(0.8));

for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${d}`);
  const legacy = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await sharp(Buffer.from(legacySquare)).resize(legacy, legacy).png().toFile(path.join(dir, "ic_launcher.png"));
  await sharp(Buffer.from(legacyRound)).resize(legacy, legacy).png().toFile(path.join(dir, "ic_launcher_round.png"));
  await sharp(Buffer.from(foreground)).resize(fg, fg).png().toFile(path.join(dir, "ic_launcher_foreground.png"));
}
fs.writeFileSync(
  path.join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
);
// A preview of the adaptive icon as most launchers mask it (for checking by eye).
await sharp(Buffer.from(svg(scaled(0.8), `<circle cx="54" cy="54" r="54" fill="${BG}"/>`)))
  .resize(512, 512)
  .png()
  .toFile(path.join(root, "assets", "icon-preview.png"));
console.log("Android icons written");
