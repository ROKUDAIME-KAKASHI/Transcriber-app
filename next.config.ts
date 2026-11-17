import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the Life OS repo but is its own project:
  // pin the root so Next doesn't pick up the parent folder's lockfile.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
