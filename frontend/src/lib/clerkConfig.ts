/**
 * Inside the Phaarvai website (NEXT_PUBLIC_BASE_PATH set) Clerk runs on the website's own
 * domain (www.phaarvai.com, served by clerk.phaarvai.com). Clerk's automatic "/__clerk" proxy
 * for *.vercel.app must stay off there, or the browser asks the website for /__clerk and gets
 * 404. Imported first by the root layout and the middleware. The standalone deployment (no
 * base path) is not affected.
 */
if ((process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim() && !(process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? "").trim()) {
  process.env.CLERK_DISABLE_AUTO_PROXY = "true";
}

export {};