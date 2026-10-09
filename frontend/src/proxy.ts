import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  "/privacy-policy",
  "/terms",
  "/help",
  "/contact",
  "/explore/(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's script and API in production on *.vercel.app: with production keys Clerk
    // loads itself from /__clerk/... on this site, and the middleware forwards those
    // requests to Clerk. They end in .js, so the line above would skip them (404).
    // Development keys never use this path, so local development is unchanged.
    "/__clerk/(.*)",
  ],
};
