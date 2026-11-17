import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the root so Next doesn't pick up a parent folder's lockfile.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),

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
