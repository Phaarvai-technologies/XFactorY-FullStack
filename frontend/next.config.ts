import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Browser security headers for every page. They change nothing visible:
// - no other site may show these pages inside a frame (clickjacking),
// - files are used only as the type the server says (no MIME sniffing),
// - other sites receive only the origin in the Referer header,
// - camera / microphone / location are not used, so they are switched off.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Hide the Next.js route indicator (circular "N") that overlays bottom-left UI in dev.
  devIndicators: false,
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
