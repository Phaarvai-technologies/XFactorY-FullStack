import "@/lib/clerkConfig";
import { clerkFrontendApiProxy, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { checkRegistration } from "@/lib/auth/registration";

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

// Inside the website the sign-in pages live under the base path (/xfactory/sign-in).
const underBase = (path: string | undefined, fallback: string) => {
  const p = path?.trim() || fallback;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");
  return base && p.startsWith("/") && !p.startsWith(`${base}/`) ? `${base}${p}` : p;
};
const clerkPaths = process.env.NEXT_PUBLIC_BASE_PATH?.trim()
  ? {
      signInUrl: underBase(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL, "/sign-in"),
      signUpUrl: underBase(process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL, "/sign-up"),
    }
  : {};

// Pages that need a REGISTERED X!Y user, not just a Clerk session: every protected page plus
// the Manufacturer profile setup (public route only so signed-out visitors reach Create Account).
const isSignedInOnlyPage = createRouteMatcher(["/manufacturer/account(.*)"]);

/*
 * Registration gate. A Clerk session (including one created before this check existed, or
 * from an unknown Google sign-in) is not enough: the backend must confirm the identity
 * completed X!Y sign-up. Not registered → Sign-up with "Please sign up first, then sign in
 * to continue." Backend unreachable → the page is served (an outage is never "not
 * registered"); its data still comes only from the API, which refuses unregistered users.
 * A positive answer is remembered for a few minutes in an HMAC-signed, user-bound cookie so
 * navigation does not call the backend on every request.
 */
const REG_COOKIE = "xy_reg";
const REG_COOKIE_SECONDS = 300;

const toB64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let regKey: Promise<CryptoKey | null> | null = null;
function registrationCookieKey(): Promise<CryptoKey | null> {
  regKey ??= (async () => {
    const secret = process.env.CLERK_SECRET_KEY?.trim();
    if (!secret) return null; // no server secret: no caching, every check asks the backend
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const derived = await crypto.subtle.sign("HMAC", base, enc.encode("xy-registration-cookie-v1"));
    return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  })();
  return regKey;
}

async function signRegistration(userId: string, expires: number): Promise<string | null> {
  const key = await registrationCookieKey();
  if (!key) return null;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}.${expires}`));
  return toB64Url(mac);
}

async function hasRegistrationCookie(request: NextRequest, userId: string): Promise<boolean> {
  const value = request.cookies.get(REG_COOKIE)?.value;
  if (!value) return false;
  const [owner, exp, mac] = value.split(".");
  const expires = Number(exp);
  if (owner !== userId || !Number.isFinite(expires) || expires < Date.now() / 1000 || !mac) return false;
  const expected = await signRegistration(userId, expires);
  if (!expected || expected.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Relative Location, so the browser keeps the address it uses (also inside the website). */
function redirectToSignUp(request: NextRequest): Response {
  const back = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const query = new URLSearchParams({ notice: "signup_required" });
  if (back && back !== "/") query.set("redirect_url", back);
  const response = new Response(null, { status: 307, headers: { Location: `${BASE}/sign-up?${query}` } });
  response.headers.append("Set-Cookie", `${REG_COOKIE}=; Path=${BASE || "/"}; Max-Age=0; HttpOnly; SameSite=Lax`);
  return response;
}

const clerk = clerkMiddleware(async (auth, request) => {
  const publicRoute = isPublicRoute(request);
  if (!publicRoute) {
    await auth.protect();
  }
  if (publicRoute && !isSignedInOnlyPage(request)) return;

  const session = await auth();
  if (!session.userId) return; // signed-out visitors: unchanged (Clerk / the page handle them)
  if (await hasRegistrationCookie(request, session.userId)) return;

  const check = await checkRegistration(await session.getToken().catch(() => null), {
    signal: AbortSignal.timeout(4000),
  });
  if (check.state === "unregistered") return redirectToSignUp(request);
  if (check.state !== "registered") return; // outage / suspended: the API decides per request

  const expires = Math.floor(Date.now() / 1000) + REG_COOKIE_SECONDS;
  const mac = await signRegistration(session.userId, expires);
  if (!mac) return;
  const response = NextResponse.next();
  response.cookies.set(REG_COOKIE, `${session.userId}.${expires}.${mac}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    path: BASE || "/",
    maxAge: REG_COOKIE_SECONDS,
  });
  return response;
}, clerkPaths);

/*
 * Inside the Phaarvai website (NEXT_PUBLIC_BASE_PATH=/xfactory) Clerk runs through
 * NEXT_PUBLIC_CLERK_PROXY_URL=https://phaarvai-website.vercel.app/__clerk — the same /__clerk
 * shape as Clerk's own automatic proxy on *.vercel.app, which Clerk accepts without any
 * dashboard setting. The website forwards /__clerk/... to /xfactory/__clerk/... here; this sends
 * it on to Clerk and tells Clerk the address the browser sees, so its cookies belong to the
 * website. Without that setting, Clerk's own automatic /__clerk proxy is used exactly as before.
 */
const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");
const clerkProxy = (() => {
  const value = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  const url = new URL(value);
  const publicPath = url.pathname.replace(/\/+$/, "") || "/__clerk"; // what the browser and Clerk see
  // Where those requests arrive in this app (Next.js serves everything under the base path).
  const localPath = BASE && !publicPath.startsWith(`${BASE}/`) ? `${BASE}${publicPath}` : publicPath;
  return { host: url.host, proto: url.protocol.replace(":", ""), publicPath, localPath };
})();

/* NEXT_PUBLIC_SITE_ORIGIN (only set when running inside the website). */
const siteOrigin = (() => {
  const value = process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim();
  if (!BASE || !value || !/^https?:\/\//i.test(value)) return null;
  const url = new URL(value);
  return { host: url.host, proto: url.protocol.replace(":", "") };
})();

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (clerkProxy) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === clerkProxy.localPath || pathname.startsWith(`${clerkProxy.localPath}/`)) {
      url.pathname = `${clerkProxy.publicPath}${pathname.slice(clerkProxy.localPath.length)}`;
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", clerkProxy.host);
      headers.set("x-forwarded-proto", clerkProxy.proto);
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const forwarded = new Request(url.toString(), {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      return clerkFrontendApiProxy(forwarded, { proxyPath: clerkProxy.publicPath });
    }
  }
  if (siteOrigin) {
    // Served through the website (e.g. https://www.phaarvai.com/xfactory): Clerk must see the
    // address the browser uses, so its sign-in checks and redirects stay on the website.
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", siteOrigin.host);
    headers.set("x-forwarded-proto", siteOrigin.proto);
    const viaSite = new NextRequest(request, { headers, nextConfig: BASE ? { basePath: BASE } : undefined });
    return clerk(viaSite, event);
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
