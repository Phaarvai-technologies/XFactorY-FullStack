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
  ],
};
