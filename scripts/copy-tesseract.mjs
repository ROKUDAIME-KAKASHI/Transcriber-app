// Copies the Tesseract.js OCR files into public/tesseract/ so reading names off the call screen (Phase 23)
// is served from our own origin. Cross-origin files would be blocked by the site's COOP/COEP headers, and
// this keeps naming free of any CDN. Runs after `npm install`, next to copy-ort.mjs.
//   worker.min.js                     the OCR web worker
//   tesseract-core-simd-lstm.wasm.js  the OCR engine (SIMD WebAssembly, LSTM only; the wasm is inlined)
//   lang/eng.traineddata.gz           English model, integer-quantised "best" data (about 3 MB)
// Hindi (@tesseract.js-data/hin, about 1.4 MB) is installed but deliberately not copied: tile names on
// Meet, Teams and Zoom are overwhelmingly Latin script, and a second language slows every read.
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "tesseract");
const require = createRequire(import.meta.url);

// Resolve each package with require.resolve (not a hoisted node_modules path). tesseract.js-core is a dependency of
// tesseract.js, so it is looked up from there. A missing package fails the install loudly: a deploy that silently
// ships without OCR files is worse than a failed one.
function pkgDir(name, from) {
  try {
    return dirname(require.resolve(name + "/package.json", from ? { paths: [from] } : undefined));
  } catch (err) {
    console.error("copy-tesseract: cannot resolve " + name + " (" + (err && err.code ? err.code : "error") + "). Run npm install.");
    process.exit(1);
  }
}
const tess = pkgDir("tesseract.js");
const core = pkgDir("tesseract.js-core", tess);
const eng = pkgDir("@tesseract.js-data/eng");

const files = [
  [join(tess, "dist", "worker.min.js"), join(dest, "worker.min.js")],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), join(dest, "tesseract-core-simd-lstm.wasm.js")],
  [join(eng, "4.0.0_best_int", "eng.traineddata.gz"), join(dest, "lang", "eng.traineddata.gz")],
];

for (const [src] of files) {
  if (!existsSync(src)) {
    console.error("copy-tesseract: missing " + src);
    process.exit(1);
  }
}
mkdirSync(join(dest, "lang"), { recursive: true });
for (const [src, out] of files) {
  copyFileSync(src, out);
  console.log(`copy-tesseract: ${out.slice(root.length + 1)} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
}
