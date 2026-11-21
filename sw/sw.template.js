// Generated into public/sw.js by sw/build.mjs. Do not edit public/sw.js; edit this template.
// Offline app shell: precaches hashed chunks, serves prerendered shells when the network fails.
/*__ROUTING__*/
/*__MANIFEST__*/

var ASSET_CACHE = "tr-assets-v1";
var SHELL_CACHE = "tr-shell-" + MANIFEST.version;
var LEGACY_CACHE = "transcriber-shell-v1";
var NAV_TIMEOUT_MS = 3000;
var ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

function goodResponse(res) {
  return res && res.ok && !res.redirected && res.type === "basic";
}

function fetchGood(url) {
  return fetch(url, { cache: "reload", credentials: "same-origin" }).then(function (res) {
    if (!goodResponse(res)) throw new Error("precache failed: " + url + " " + (res && res.status));
    return res;
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      var assets = await caches.open(ASSET_CACHE);
      var shells = await caches.open(SHELL_CACHE);
      var jobs = [];
      MANIFEST.assets.forEach(function (url) {
        jobs.push(
          assets.match(url).then(function (hit) {
            if (hit) return;
            return fetchGood(url).then(function (res) {
              return assets.put(url, res);
            });
          })
        );
      });
      MANIFEST.shells.forEach(function (url) {
        jobs.push(
          fetchGood(url).then(function (res) {
            return shells.put(url, res);
          })
        );
      });
      await Promise.all(jobs);
    })()
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      var keys = await caches.keys();
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === LEGACY_CACHE || (k.indexOf("tr-shell-") === 0 && k !== SHELL_CACHE)) await caches.delete(k);
      }
      var assets = await caches.open(ASSET_CACHE);
      var keep = {};
      MANIFEST.assets.forEach(function (u) { keep[u] = true; });
      MANIFEST.lazy.forEach(function (l) { keep[l.url] = true; });
      var reqs = await assets.keys();
      for (var j = 0; j < reqs.length; j++) {
        var p = new URL(reqs[j].url).pathname;
        if (!keep[p]) await assets.delete(reqs[j]);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "WARM_LAZY") {
    event.waitUntil(
      (async function () {
        var assets = await caches.open(ASSET_CACHE);
        for (var i = 0; i < MANIFEST.lazy.length; i++) {
          var url = MANIFEST.lazy[i].url;
          try {
            if (await assets.match(url)) continue;
            var res = await fetch(url, { credentials: "same-origin" });
            if (goodResponse(res)) await assets.put(url, res);
          } catch (e) {
            /* ignore: lazy tier is best effort */
          }
        }
      })()
    );
  }
});

function offlineFallbackResponse() {
  var headers = { "Content-Type": "text/html; charset=utf-8" };
  headers["Cross-Origin-Opener-Policy"] = ISOLATION["Cross-Origin-Opener-Policy"];
  headers["Cross-Origin-Embedder-Policy"] = ISOLATION["Cross-Origin-Embedder-Policy"];
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Offline</title><body style='font-family:sans-serif;padding:2rem'><h1>You're offline</h1>" +
      "<p>Open the app once with internet so it can be saved for offline use.</p>",
    { status: 200, headers: headers }
  );
}

function redirectResponse(location) {
  var headers = { Location: location };
  headers["Cross-Origin-Opener-Policy"] = ISOLATION["Cross-Origin-Opener-Policy"];
  headers["Cross-Origin-Embedder-Policy"] = ISOLATION["Cross-Origin-Embedder-Policy"];
  return new Response(null, { status: 302, headers: headers });
}

async function cachedShell(shell) {
  var cache = await caches.open(SHELL_CACHE);
  var hit = await cache.match(shell, { ignoreVary: true, ignoreSearch: true });
  return hit || offlineFallbackResponse();
}

async function handleAsset(request) {
  var cache = await caches.open(ASSET_CACHE);
  var hit = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
  if (hit) return hit;
  var res = await fetch(request);
  if (res.status === 200 && res.type === "basic") {
    try { await cache.put(request, res.clone()); } catch (e) { /* quota */ }
  }
  return res;
}

async function handleNav(request, decision) {
  if (decision.redirect) return redirectResponse(decision.redirect);
  try {
    var res = await Promise.race([
      fetch(request),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, NAV_TIMEOUT_MS);
      }),
    ]);
    if (res.status >= 500) return await cachedShell(decision.shell);
    return res;
  } catch (e) {
    return await cachedShell(decision.shell);
  }
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var decision = route(new URL(request.url), request, self.location.origin);
  if (decision.kind === "pass") return;
  if (decision.kind === "asset") {
    event.respondWith(handleAsset(request));
  } else if (decision.kind === "nav") {
    event.respondWith(handleNav(request, decision));
  }
});
