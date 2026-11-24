// Pure SW routing. No imports: inlined verbatim into public/sw.js and also loaded by node tests.
var MEETING_ID_RE_SOURCE = "^[a-z0-9_-]{16,40}$";
var MEETING_ID_RE_LOCAL = new RegExp(MEETING_ID_RE_SOURCE);
var SHELLS = ["/", "/meetings", "/meeting", "/login", "/offline"];

function shellFor(pathname) {
  var p = pathname.length > 1 && pathname.charAt(pathname.length - 1) === "/" ? pathname.slice(0, -1) : pathname;
  if (SHELLS.indexOf(p) !== -1) return { shell: p };
  var m = /^\/meetings\/([^/]+)$/.exec(p);
  if (m && MEETING_ID_RE_LOCAL.test(m[1])) return { redirect: "/meeting?id=" + m[1] };
  return { shell: "/offline" };
}

function isRscRequest(url, request) {
  var h = request.headers;
  if (h && (h.get("rsc") || h.get("next-router-prefetch") || h.get("next-router-segment-prefetch"))) return true;
  return url.searchParams.has("_rsc");
}

function route(url, request, origin) {
  if (request.method !== "GET") return { kind: "pass" };
  if (url.origin !== origin) return { kind: "pass" };
  var path = url.pathname;
  if (path === "/api" || path.indexOf("/api/") === 0) return { kind: "pass" };
  if (path.indexOf("/downloads/") === 0) return { kind: "pass" };
  if (isRscRequest(url, request)) return { kind: "pass" };
  if (path.indexOf("/_next/static/") === 0 || path.indexOf("/ort/") === 0) return { kind: "asset" };
  if (request.mode === "navigate") {
    var r = shellFor(path);
    return r.redirect ? { kind: "nav", redirect: r.redirect } : { kind: "nav", shell: r.shell };
  }
  return { kind: "pass" };
}

if (typeof module !== "undefined") {
  module.exports = { shellFor: shellFor, route: route, isRscRequest: isRscRequest, MEETING_ID_RE_SOURCE: MEETING_ID_RE_SOURCE };
}
