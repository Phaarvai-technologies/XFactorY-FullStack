import { clerkFrontendApiProxy, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  // Public Manufacturer overview. Account page redirects signed-out users to /sign-up.
  // /manufacturer/dashboard stays Clerk-protected.
  "/manufacturer",
  "/manufacturer/account(.*)",
  // Admin dashboard: has its own sign-in page (/admin/login) with two methods — admin
  // email + password, or the X!Y (Clerk) account. The backend checks every admin API call.
  "/admin(.*)",
  // Public Visionary overview. The Visionary flow (/visionaries/flow) stays behind sign-in.
  "/visionaries",
]);

const clerk = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

/*
 * Inside the Phaarvai website (NEXT_PUBLIC_BASE_PATH=/xfactory) Clerk runs through
 * NEXT_PUBLIC_CLERK_PROXY_URL, e.g. https://phaarvai-website.vercel.app/xfactory/__clerk.
 * The website forwards those requests here; this sends them on to Clerk and tells Clerk the
 * address the browser sees, so its cookies belong to the website. Without that setting,
 * Clerk's own automatic /__clerk proxy is used exactly as before.
 */
const clerkProxy = (() => {
  const value = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  const url = new URL(value);
  return { origin: url.origin, host: url.host, proto: url.protocol.replace(":", ""), path: url.pathname.replace(/\/+$/, "") };
})();

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (clerkProxy) {
    const { pathname } = new URL(request.url);
    if (pathname === clerkProxy.path || pathname.startsWith(`${clerkProxy.path}/`)) {
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", clerkProxy.host);
      headers.set("x-forwarded-proto", clerkProxy.proto);
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const forwarded = new Request(request.url, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      return clerkFrontendApiProxy(forwarded, { proxyPath: clerkProxy.path });
    }
  }
  return clerk(request, event);
}

export const config = {
  matcher: [
    // The home page on its own: with NEXT_PUBLIC_BASE_PATH it is "/xfactory", which the
    // pattern below does not cover.
    "/",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's script and API in production on *.vercel.app: with production keys Clerk
    // loads itself from /__clerk/... on this site, and the middleware forwards those
    // requests to Clerk. They end in .js, so the line above would skip them (404).
    // Development keys never use this path, so local development is unchanged.
    "/__clerk/(.*)",
  ],
};
