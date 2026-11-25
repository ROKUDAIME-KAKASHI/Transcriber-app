// Copies the Tesseract.js OCR files into public/tesseract/ so reading names off the call screen (Phase 23)
// is served from our own origin. Cross-origin files would be blocked by the site's COOP/COEP headers, and
// this keeps naming free of any CDN. Runs after `npm install`, next to copy-ort.mjs.
//   worker.min.js                     the OCR web worker
//   tesseract-core-simd-lstm.wasm.js  the OCR engine (SIMD WebAssembly, LSTM only; the wasm is inlined)
//   lang/eng.traineddata.gz           English model, integer-quantised "best" data (about 3 MB)
// Hindi (@tesseract.js-data/hin, about 1.4 MB) is installed but deliberately not copied: tile names on
// Meet, Teams and Zoom are overwhelmingly Latin script, and a second language slows every read.
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const dest = join(root, "public", "tesseract");

const files = [
  [join(nm, "tesseract.js", "dist", "worker.min.js"), join(dest, "worker.min.js")],
  [join(nm, "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"), join(dest, "tesseract-core-simd-lstm.wasm.js")],
  [join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), join(dest, "lang", "eng.traineddata.gz")],
];

if (!files.every(([src]) => existsSync(src))) {
  console.warn("copy-tesseract: tesseract.js files not installed, skipping");
  process.exit(0);
}
mkdirSync(join(dest, "lang"), { recursive: true });
for (const [src, out] of files) {
  copyFileSync(src, out);
  console.log(`copy-tesseract: ${out.slice(root.length + 1)} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
}
