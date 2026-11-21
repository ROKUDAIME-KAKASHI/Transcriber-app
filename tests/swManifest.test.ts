import { test } from "node:test";
import assert from "node:assert/strict";
import manifest from "../sw/manifest.js";

test("keeps js/css chunks and fonts", () => {
  const out = manifest.selectPrecache(["chunks/b.js", "chunks/a.css", "media/f.woff2"]);
  assert.deepEqual(out, ["chunks/a.css", "chunks/b.js", "media/f.woff2"]);
});
test("drops map and ts", () => {
  assert.deepEqual(manifest.selectPrecache(["chunks/a.js.map", "chunks/a.d.ts"]), []);
});
test("drops asyncify wasm", () => {
  assert.deepEqual(manifest.selectPrecache(["media/ort-wasm-simd-threaded.asyncify.abc.wasm"]), []);
});
test("drops webgpu mjs", () => {
  assert.deepEqual(manifest.selectPrecache(["media/ort.webgpu.bundle.min.abc.mjs"]), []);
});
test("drops build-id directory", () => {
  assert.deepEqual(manifest.selectPrecache(["BUILDID123/_buildManifest.js", "BUILDID123/_ssgManifest.js"]), []);
});
test("drops any wasm", () => {
  assert.deepEqual(manifest.selectPrecache(["media/x.wasm", "chunks/y.wasm"]), []);
});
test("makeVersion varies with timestamp", () => {
  assert.notEqual(manifest.makeVersion(["a"], ["b"], 1), manifest.makeVersion(["a"], ["b"], 2));
});
test("makeVersion stable", () => {
  assert.equal(manifest.makeVersion(["a"], ["b"], 1), manifest.makeVersion(["a"], ["b"], 1));
});
