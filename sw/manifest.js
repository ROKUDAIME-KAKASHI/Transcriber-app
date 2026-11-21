// Precache selection + SW version. Used by sw/build.mjs and tests only (never inlined in the SW).
function selectPrecache(relativePaths) {
  var out = [];
  relativePaths.forEach(function (raw) {
    var p = String(raw).replace(/\\/g, "/").replace(/^\/+/, "");
    var seg = p.split("/");
    if (seg[0] !== "chunks" && seg[0] !== "media") return; // build-id dirs etc.
    if (/\.map$/.test(p) || /\.ts$/.test(p) || /\.wasm$/.test(p)) return;
    if (/asyncify/.test(p) || /ort\.webgpu\.bundle[^/]*\.mjs$/.test(p)) return;
    if (seg[0] === "chunks" && !/\.(js|css)$/.test(p)) return;
    if (seg[0] === "media" && !/\.(woff2?|ttf|otf)$/.test(p)) return;
    out.push(p);
  });
  return out.sort();
}

function makeVersion(assets, lazy, timestamp) {
  var crypto = require("node:crypto");
  var h = crypto.createHash("sha256");
  h.update(JSON.stringify([assets.slice().sort(), lazy.slice().sort(), String(timestamp)]));
  return h.digest("hex").slice(0, 12);
}

if (typeof module !== "undefined") module.exports = { selectPrecache: selectPrecache, makeVersion: makeVersion };
