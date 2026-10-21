import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Empty: the app lives at the root of its own domain (default).
// "/xfactory": the app lives inside the Phaarvai website at /xfactory (see src/lib/basePath.ts).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");

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

// Inside the Phaarvai website the browser's address (www.phaarvai.com) differs from this
// deployment's own host, which the website forwards to. Next.js refuses server actions (used by
// Clerk's "Sign out") whose Origin is not this host unless that origin is listed here.
const siteHost = (() => {
  try {
    const value = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "").trim();
    return value ? new URL(value).host : "";
  } catch {
    return "";
  }
})();
const actionOrigins = siteHost
  ? [...new Set([siteHost, siteHost.replace(/^www\./, ""), siteHost.startsWith("www.") ? siteHost : `www.${siteHost}`])]
  : [];

const nextConfig: NextConfig = {
  // Hide the Next.js route indicator (circular "N") that overlays bottom-left UI in dev.
  devIndicators: false,
  ...(basePath ? { basePath } : {}),
  ...(actionOrigins.length ? { experimental: { serverActions: { allowedOrigins: actionOrigins } } } : {}),
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    // With a base path, this deployment's own root sends visitors to the app.
    return basePath ? [{ source: "/", destination: basePath, basePath: false, permanent: false }] : [];
  },
};

export default nextConfig;
