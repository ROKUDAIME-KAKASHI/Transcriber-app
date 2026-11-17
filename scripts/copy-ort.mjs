// Copies the ONNX Runtime WebAssembly files into public/ort/ so the on-device
// speech model is served from our own origin. Same-origin is required for the
// multi-threaded runtime (it spawns its own workers), and it removes a runtime
// dependency on a third-party CDN. Runs automatically after `npm install`.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "onnxruntime-web", "dist");
const dest = join(root, "public", "ort");
const files = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

if (!existsSync(src)) {
  console.warn("copy-ort: onnxruntime-web not installed, skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`copy-ort: copied ${files.length} files to public/ort`);
