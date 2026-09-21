import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Hide the Next.js route indicator (circular "N") that overlays bottom-left UI in dev.
  devIndicators: false,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
