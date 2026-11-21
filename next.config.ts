import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the root so Next doesn't pick up a parent folder's lockfile.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),

  // Dev only: Next blocks its dev scripts for any host other than localhost, so a phone opening
  // http(s)://<laptop-ip>:3001 got the page but no JavaScript (every button dead). Allow private
  // LAN addresses and the HTTPS tunnels used for phone testing (see README "Testing on a phone").
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local", "*.ngrok-free.app", "*.ngrok.app", "*.trycloudflare.com"],

  // Generates public/sw.js (offline shell service worker) after the production build.
  compiler: {
    async runAfterProductionCompile({ distDir, projectDir }: { distDir: string; projectDir: string }) {
      const { pathToFileURL } = await import("node:url");
      const path = await import("node:path");
      // The config is transpiled to CJS, which would turn import() into require(); use a real dynamic import.
      const nativeImport = new Function("u", "return import(u)") as (u: string) => Promise<{ buildServiceWorker: (o: { projectDir: string; distDir: string }) => Promise<void> }>;
      const mod = await nativeImport(pathToFileURL(path.resolve(projectDir, "sw/build.mjs")).href);
      await mod.buildServiceWorker({ projectDir, distDir });
    },
  },

  async headers() {
    return [
      {
        // Cross-origin isolation unlocks SharedArrayBuffer, which the on-device
        // speech model needs to use several CPU cores (2–3× faster on phones).
        // Side effect: cross-origin resources must be CORS/CORP-enabled. The app
        // only loads Hugging Face model files and the sample clip (both CORS-enabled).
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        source: "/ort/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
